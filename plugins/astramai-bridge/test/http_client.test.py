"""
在本机验证插件里的 HTTP 客户端**用的是真代码**。

做法：给 `wit_world.*` 打桩，然后直接加载 `src/app.py`，
再调它的 `http_get` / `probe_network` 打真实服务器。

这样测的不是复制品 —— 改了 `app.py` 这个测试立刻能反映出来。

⚠️ 本机能跑通**不代表 WASI 里能跑通**（WASI 的 socket 是另一套实现）。
这个测试保证的是：**我们的 HTTP 报文格式本身没写错**。
"""

import importlib.util
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def stub_wit_world():
    """造一套最小的 `wit_world` 桩模块。

    只需要满足 `import` 时不报错 —— 测试不会调用宿主接口。
    """

    class _Dummy:
        def __getattr__(self, name):
            # Element(...) 之类被调用时返回另一个 dummy
            return lambda *args, **kwargs: _Dummy()

    wit_world = types.ModuleType('wit_world')
    exports = types.ModuleType('wit_world.exports')
    exports.Lifecycle = type('Lifecycle', (), {})
    exports.Event = type('Event', (), {})

    imports = types.ModuleType('wit_world.imports')
    for name in ('device', 'interconnect', 'register', 'ui'):
        module = types.ModuleType(f'wit_world.imports.{name}')
        module.__getattr__ = lambda attr, _d=_Dummy(): _d
        setattr(imports, name, module)

    wit_world.exports = exports
    wit_world.imports = imports
    wit_world._dummy = _Dummy

    sys.modules['wit_world'] = wit_world
    sys.modules['wit_world.exports'] = exports
    sys.modules['wit_world.imports'] = imports
    for name in ('device', 'interconnect', 'register', 'ui'):
        sys.modules[f'wit_world.imports.{name}'] = getattr(imports, name)


def load_plugin():
    stub_wit_world()
    spec = importlib.util.spec_from_file_location('astramai_plugin', ROOT / 'src' / 'app.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    plugin = load_plugin()
    print(f'  服务器：{plugin.SERVER_BASE}')
    print()

    failures = []

    # ① 端点拆分
    host, port, base = plugin._parse_endpoint()
    print(f'  _parse_endpoint -> host={host} port={port} base={base!r}')
    if not (host and port):
        failures.append('_parse_endpoint 没拆出 host/port')

    # ② 真实 HTTP 请求（最关键的一条）
    print('\n  打 /api/health …')
    try:
        status, text = plugin.http_get('/api/health', timeout=10)
        print(f'    status = {status}')
        print(f'    body   = {text[:110]}')
        if status != 200:
            failures.append(f'http_get 状态码是 {status}，应该是 200')
        if 'AstraMai server' not in text:
            failures.append('响应里没有服务名，可能打到了别的服务')
    except Exception as error:
        failures.append(f'http_get 抛异常：{type(error).__name__}: {error}')

    # ③ fetch_json 的信封处理
    print('\n  fetch_json("/api/health") …')
    ok, body = plugin.fetch_json('/api/health')
    print(f'    ok = {ok}')
    print(f'    keys = {sorted(body.keys())[:6]}')
    if not ok:
        failures.append(f'fetch_json 失败：{body}')

    # ④ 404 应该被判成失败
    print('\n  fetch_json("/api/definitely-not-here") …')
    ok, body = plugin.fetch_json('/api/definitely-not-here')
    print(f'    ok = {ok}  message = {body.get("message")}')
    if ok:
        failures.append('404 竟然被当成成功了')

    # ⑤ probe_network 的整体判定
    print('\n  probe_network() …')
    ok, text = plugin.probe_network()
    print(f'    {ok}  {text}')
    if not ok:
        failures.append(f'probe_network 失败：{text}')

    print()
    if failures:
        print('❌ 失败：')
        for item in failures:
            print(f'   · {item}')
        sys.exit(1)
    print('✅ 全部通过')


if __name__ == '__main__':
    main()

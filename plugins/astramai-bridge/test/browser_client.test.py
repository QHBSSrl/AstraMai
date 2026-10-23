"""
在本机验证插件里**最易错的那层**：浏览器 eval 的结果怎么解。

⚠️ 这里测不了真网络 —— 网络走的是宿主的 WebView，本机没有。
这个测试保证的是：

  · `_xhr_script` 拼出来的 JS 里路径被正确转义
  · `eval` 返回值需要**解两层 JSON** 这件事没搞反
  · 200 / 404 / 非 JSON / 浏览器报错 四种情况都处理对

那段解包的逻辑最容易被改坏，而且坏了只有运行时才知道。

跑：python plugins/astramai-bridge/test/browser_client.test.py
"""

import asyncio
import importlib.util
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

failures = []


def check(condition, message):
    if condition:
        print(f'  ✅ {message}')
    else:
        print(f'  ❌ {message}')
        failures.append(message)


def stub_wit_world(eval_result_getter):
    """造 `wit_world` 桩。

    `browser.eval` 返回什么由 `eval_result_getter(script)` 决定，
    这样能精确模拟宿主的行为。
    """

    class FakeOpenOptions:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    browser_module = types.ModuleType('wit_world.imports.browser')
    browser_module.OpenOptions = FakeOpenOptions
    browser_module.Cookie = type('Cookie', (), {})

    opened = {'count': 0, 'closed': 0, 'scripts': []}

    async def fake_open(options):
        opened['count'] += 1
        return 7

    async def fake_eval(browser_id, script):
        opened['scripts'].append(script)
        return eval_result_getter(script)

    async def fake_close(browser_id):
        opened['closed'] += 1

    browser_module.open = fake_open
    browser_module.eval = fake_eval
    browser_module.close = fake_close

    wit_world = types.ModuleType('wit_world')
    exports = types.ModuleType('wit_world.exports')
    exports.Lifecycle = type('Lifecycle', (), {})
    exports.Event = type('Event', (), {})
    imports = types.ModuleType('wit_world.imports')
    imports.browser = browser_module

    for name in ('device', 'interconnect', 'register', 'ui'):
        module = types.ModuleType(f'wit_world.imports.{name}')
        setattr(imports, name, module)
        sys.modules[f'wit_world.imports.{name}'] = module

    wit_world.exports = exports
    wit_world.imports = imports

    sys.modules['wit_world'] = wit_world
    sys.modules['wit_world.exports'] = exports
    sys.modules['wit_world.imports'] = imports
    sys.modules['wit_world.imports.browser'] = browser_module

    return opened


def load_plugin(eval_result_getter):
    opened = stub_wit_world(eval_result_getter)
    spec = importlib.util.spec_from_file_location('astramai_plugin', ROOT / 'src' / 'app.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, opened


def main():
    print('① 200：正常响应')
    plugin, opened = load_plugin(
        lambda script: '"[{\\"status\\":200,\\"body\\":\\"{\\\\\\"ok\\\\\\":true}\\"}]"'.replace(
            '[{', '{'
        ).replace('}]', '}')
    )
    # 上面的转义太脆，直接用 ensure_ascii 拼一个真实的双层 JSON
    import json as _json

    inner = {'status': 200, 'body': '{"ok":true,"data":{"mode":"live"}}'}
    double = _json.dumps(_json.dumps(inner))

    plugin, opened = load_plugin(lambda script: double)
    ok, body = asyncio.run(plugin.fetch_json('/api/health'))
    check(ok is True, '200 被判成成功')
    check(body.get('ok') is True, '信封解析出来了')
    check(opened['count'] == 1, '浏览器只开了一次（复用）')

    print('\n② 404：服务端错误信封里 message 是对象')
    inner = {
        'status': 404,
        'body': _json.dumps(
            {
                'ok': False,
                'message': {'kind': 'not-found', 'message': 'x', 'friendlyMessage': '接口不存在。'},
            }
        ),
    }
    plugin, _ = load_plugin(lambda script: _json.dumps(_json.dumps(inner)))
    ok, body = asyncio.run(plugin.fetch_json('/nope'))
    check(ok is False, '404 被判成失败')
    check(
        isinstance(body.get('message'), str) and body['message'] == '接口不存在。',
        f'message 被压成字符串（实际：{body.get("message")!r}）',
    )

    print('\n③ 响应不是 JSON')
    inner = {'status': 200, 'body': '<html>oops</html>'}
    plugin, _ = load_plugin(lambda script: _json.dumps(_json.dumps(inner)))
    ok, body = asyncio.run(plugin.fetch_json('/x'))
    check(ok is False, '非 JSON 被判成失败')
    check('不是 JSON' in body.get('message', ''), '错误文案说清了原因')

    print('\n④ 浏览器里 XHR 自己报错')
    inner = {'__error': 'NetworkError'}
    plugin, _ = load_plugin(lambda script: _json.dumps(_json.dumps(inner)))
    ok, body = asyncio.run(plugin.fetch_json('/x'))
    check(ok is False, '浏览器报错被判成失败')
    check('NetworkError' in body.get('message', ''), '错误信息透传出来了')

    print('\n⑤ _xhr_script 的转义')
    plugin, _ = load_plugin(lambda script: '"{}"')
    script = plugin._xhr_script("/a'b", 1000)
    check(
        'XMLHttpRequest' in script,
        '用的是 XMLHttpRequest（不是 fetch，fetch 返回 Promise 拿不到结果）',
    )
    check("'/a\\'b'" in script, '路径里的单引号被转义成 JS 字符串了')

    print()
    if failures:
        print(f'❌ {len(failures)} 项失败')
        sys.exit(1)
    print('✅ 全部通过')


if __name__ == '__main__':
    main()

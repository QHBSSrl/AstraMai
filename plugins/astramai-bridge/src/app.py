"""
AstraMai · AstroBox 网桥插件

把「手表/手环上的 AstraMai」和「我们的查分服务器」接起来。

────────────── 为什么需要它 ──────────────────────────────────────────

手环（比如小米手环 10 Pro）的 Vela 运行时**没有网络能力**，
它只能用蓝牙通信。而 AstroBox 的插件能通过 interconnect 跟设备双向通信。

    Vela App（@system.interconnect，发 JSON 字符串）
         ↕
    AstroBox 插件（本文件）
         ↕ HTTP
    我们的服务器

手表（REDMI Watch 5 eSIM）自己能上网，不需要这个插件。

────────────── 网络：靠**应用内浏览器**，不是 socket ──────────────────

这是本插件最反直觉的一点，前后踩了三层坑：

  ① `urllib` / `http.client` / `socket.create_connection` 全都走
     `getaddrinfo`，而 WASI 的 `getaddrinfo` 是个不通的桩：
         gaierror: [Errno -4] Non-recoverable error
     明明是 IP 字面量也炸。

  ② 于是改成裸 socket：
         sock.connect(('101.132.148.117', 8787))
     结果：
         PermissionError: [Errno 2] Permission denied      ← EACCES

     **宿主根本不允许出站连接。** `wasi:sockets` / `wasi:http` 虽然在
     wasm 的 import 段里，但宿主实例化时没给这个能力。

  ③ 所以改用 `browser` 接口 —— 那是**真的 WebView**，有完整网络栈：

         id = browser.open(url=SERVER_BASE, ...)
         browser.eval(id, "同步 XHR 拿 responseText")

     `eval` 在页面里执行 JS，返回 JSON 序列化后的结果。
     这条通了。

⚠️ **改网络部分前先读这段。** 别退回去用 urllib 或裸 socket。

────────────── 安全边界 ──────────────────────────────────────────────

**插件里不碰任何上游密钥。** 它只把请求转发到我们自己的服务器，
密钥始终只在服务端（`apps/server` 的设计没变）。
"""

import json
import urllib.parse

import wit_world.exports as exports
from wit_world.imports import browser
from wit_world.imports import device as host_device
from wit_world.imports import interconnect as host_interconnect
from wit_world.imports import register as host_register
from wit_world.imports import ui

# ── 配置 ──────────────────────────────────────────────────────────────

#: 我们自己的查分服务器。
#: ⚠️ 改这里要同步改 `apps/vela/src/common/config.js` 的默认地址。
SERVER_BASE = 'http://101.132.148.117:8787'

#: 手表上 AstraMai 的快应用包名。必须和服务端/清单里一致。
WATCH_PACKAGE = 'com.astranexus.astramai'

#: 单条 interconnect 消息的字符上限。
#:
#: 手表那边要按同样的值拼回来。**这个值不能随便调大**——
#: 一次 B50 大概十几 KB，蓝牙消息有实际长度限制。
CHUNK_SIZE = 1800

#: 在浏览器里等一次 XHR 的超时。
BROWSER_TIMEOUT_MS = 15000


# ── 状态 ──────────────────────────────────────────────────────────────

STATE = {
    #: 自检结果：None 表示还没测过
    'network_ok': None,
    'network_text': '还没检测',
    #: 已订阅的设备名
    'devices': [],
    #: 最近一次渲染容器 id
    'element_id': '',
    #: 复用的浏览器 id（0 表示没开）
    'browser_id': 0,
}


# ── 网络：走应用内浏览器 ──────────────────────────────────────────────


async def ensure_browser():
    """确保有一个开着的浏览器，返回它的 id。

    为什么要复用：`browser.open` **每次都会弹一次授权**
    （官方文档明写：「这个能力能看到用户在页面里输入的一切，
    因此每次 open 都会走一次授权」）。
    一次会话只开一次，后面的请求都复用它。
    """
    if STATE['browser_id']:
        return STATE['browser_id']

    browser_id = await browser.open(
        browser.OpenOptions(
            url=SERVER_BASE + '/',
            title='AstraMai 网桥',
            user_agent=None,
            # 不用拦截前缀 —— 我们不劫持回调，只是借这个 WebView 发请求
            intercept_prefixes=[],
            close_on_intercept=False,
            ephemeral=True,
            width=None,
            height=None,
        )
    )
    STATE['browser_id'] = browser_id
    return browser_id


async def close_browser():
    """关掉浏览器。出错就算了 —— 可能用户已经手动关了。"""
    if not STATE['browser_id']:
        return
    try:
        await browser.close(STATE['browser_id'])
    except Exception:
        pass
    STATE['browser_id'] = 0


def _xhr_script(path, timeout_ms):
    """拼一段在页面里跑的 JS：同步 XHR 拿 responseText。

    用**同步** XHR 而不是 `fetch` + Promise：`eval` 的返回值会被
    JSON 序列化，而 Promise 序列化出来是 `{}`，拿不到结果。
    同步 XHR 直接给字符串，正好。

    页面 origin 就是我们的服务器，所以这里发相对路径，不用管 CORS。
    """
    # 路径里的引号要转义，防止拼出来的 JS 语法坏掉
    safe_path = path.replace('\\', '\\\\').replace("'", "\\'")
    return (
        '(function(){'
        'var x=new XMLHttpRequest();'
        f"x.open('GET','{safe_path}',false);"
        f'x.timeout={timeout_ms};'
        'try{x.send();}catch(e){return JSON.stringify({__error:String(e)});}'
        'return JSON.stringify({status:x.status,body:x.responseText});'
        '})()'
    )


async def http_get(path, timeout_ms=BROWSER_TIMEOUT_MS):
    """通过浏览器发一次 GET。返回 `(status, body_text)`。"""
    browser_id = await ensure_browser()
    raw = await browser.eval(browser_id, _xhr_script(path, timeout_ms))

    # `eval` 返回的是 JSON 序列化后的结果 —— 我们那段 JS 自己返回了
    # 一个 JSON 字符串，所以这里要解两层。
    outer = json.loads(raw)
    if isinstance(outer, str):
        inner = json.loads(outer)
    elif isinstance(outer, dict):
        inner = outer
    else:
        raise RuntimeError(f'浏览器返回了看不懂的东西：{type(outer).__name__}')

    if '__error' in inner:
        raise RuntimeError(inner['__error'])

    return int(inner.get('status') or 0), str(inner.get('body') or '')


async def fetch_json(path):
    """GET 我们服务器的某个路径，返回 `(ok, data_or_error)`。

    服务端的信封是 `{ ok, success, data, error?, message? }`。
    """
    try:
        status, text = await http_get(path)
    except Exception as error:
        return False, {'message': f'{type(error).__name__}: {error}'}

    if status == 0:
        return False, {'message': '请求没拿到状态码（可能是浏览器还没加载好）'}

    try:
        parsed = json.loads(text)
    except Exception:
        snippet = text[:120].replace('\n', ' ')
        return False, {'message': f'HTTP {status}，但响应不是 JSON：{snippet}'}

    if status >= 400 or parsed.get('ok') is False:
        # 错误信封里 `message` 有时是个对象（{kind, message, friendlyMessage}）
        raw = parsed.get('message') or parsed.get('error') or f'HTTP {status}'
        if isinstance(raw, dict):
            raw = raw.get('friendlyMessage') or raw.get('message') or f'HTTP {status}'
        return False, {'message': str(raw)}

    return True, parsed


async def probe_network():
    """自检：能不能通过浏览器打到服务器。返回 `(ok, text)`。"""
    try:
        status, text = await http_get('/api/health')
    except Exception as error:
        return False, f'浏览器请求失败（{type(error).__name__}: {error}）'

    if status != 200:
        return False, f'/api/health 返回 HTTP {status}'

    try:
        mode = (json.loads(text).get('data') or {}).get('mode', '?')
    except Exception:
        mode = '?'

    return True, f'网络通（mode={mode}）'


async def refresh_state():
    ok, text = await probe_network()
    STATE['network_ok'] = ok
    STATE['network_text'] = text
    print(f'[astramai] 自检 {"✅" if ok else "❌"} {text}')
    return ok


async def load_devices():
    try:
        devices = await host_device.get_connected_device_list()
    except Exception as error:
        print(f'[astramai] 取设备列表失败：{error}')
        STATE['devices'] = []
        return []
    STATE['devices'] = [f'{item.name}' for item in devices]
    return devices


# ── 传输层 ────────────────────────────────────────────────────────────


async def send_to_watch(address, payload):
    """把一段 JSON 发给设备。

    超过 `CHUNK_SIZE` 时**分片发送**：每片带 `seq` / `total`，
    手表那边按 `id` 收齐再拼。
    """
    text = json.dumps(payload, ensure_ascii=False)
    request_id = payload.get('id', '')
    total = max(1, (len(text) + CHUNK_SIZE - 1) // CHUNK_SIZE)

    for seq in range(total):
        chunk = text[seq * CHUNK_SIZE : (seq + 1) * CHUNK_SIZE]
        frame = {'id': request_id, 'seq': seq, 'total': total, 'chunk': chunk}
        await host_interconnect.send_qaic_message(
            address, WATCH_PACKAGE, json.dumps(frame, ensure_ascii=False)
        )


# ── 请求路由 ──────────────────────────────────────────────────────────


async def handle_request(payload):
    """把快应用的请求翻译成一次服务端调用。"""
    request_id = payload.get('id', '')
    action = payload.get('action', '')

    if action == 'ping':
        return {'id': request_id, 'ok': True, 'data': {'pong': True}}

    if action != 'b50':
        return {'id': request_id, 'ok': False, 'message': f'未知操作：{action}'}

    game = payload.get('game', 'maimai')
    code = str(payload.get('code', '')).strip()
    if not code:
        return {'id': request_id, 'ok': False, 'message': '缺少查询目标'}

    if game == 'chunithm':
        path = f'/api/v1/chunithm/bests?code={urllib.parse.quote(code)}'
    else:
        path = f'/api/v1/maimai/b50?code={urllib.parse.quote(code)}'

    ok, body = await fetch_json(path)
    if not ok:
        return {'id': request_id, 'ok': False, 'message': body.get('message', '查询失败')}

    return {'id': request_id, 'ok': True, 'data': body.get('data')}


# ── 界面 ──────────────────────────────────────────────────────────────


def build_ui():
    """构建界面树。

    ⚠️ **必须真的 render 点东西。** 什么都不做就返回的话，
    宿主的窗口会永远停在「等待插件响应渲染请求…」。
    """
    root = ui.Element(ui.ElementType.DIV, None)
    root.flex()
    root.flex_direction(ui.FlexDirection.COLUMN)
    root.padding(28)
    root.gap(14)

    title = ui.Element(ui.ElementType.P, 'AstraMai 网桥')
    title.text_color('#ff5f9e')
    root.child(title)

    if STATE['network_ok'] is True:
        network_line = f'✅ {STATE["network_text"]}'
        network_color = '#3ddc84'
    elif STATE['network_ok'] is False:
        network_line = f'❌ {STATE["network_text"]}'
        network_color = '#ff6b6b'
    else:
        network_line = '⏳ 还没检测'
        network_color = '#9bacd0'

    network = ui.Element(ui.ElementType.P, network_line)
    network.text_color(network_color)
    root.child(network)

    devices = STATE['devices']
    if devices:
        device_line = '已连接：' + '、'.join(devices)
        device_color = '#e8eefc'
    else:
        device_line = '没有已连接的手表 —— 先连上，再点下面的按钮'
        device_color = '#9bacd0'
    device_text = ui.Element(ui.ElementType.P, device_line)
    device_text.text_color(device_color)
    root.child(device_text)

    server = ui.Element(ui.ElementType.P, f'服务器：{SERVER_BASE}')
    server.text_color('#6d7fa3')
    root.child(server)

    button = ui.Element(ui.ElementType.BUTTON, '重新检测')
    button.on(ui.Event.CLICK, 'retest')
    button.padding(10)
    button.radius(10)
    root.child(button)

    return root


# ── 生命周期 ──────────────────────────────────────────────────────────


class Lifecycle(exports.Lifecycle):
    async def on_load(self):
        """插件加载时：联网自检 + 订阅设备消息。"""
        await refresh_state()

        devices = await load_devices()
        if not devices:
            print('[astramai] 现在没有已连接的设备——连上设备后点「重新检测」')
            return

        for item in devices:
            try:
                await host_register.register_interconnect_recv(item.addr, WATCH_PACKAGE)
                print(f'[astramai] 已订阅 {item.name} ({item.addr})')
            except Exception as error:
                print(f'[astramai] 订阅 {item.addr} 失败：{error}')


class Event(exports.Event):
    async def on_event(self, event_type, event_payload):
        """`interconnect-message` 的 payload 就是设备发过来的原样字符串。"""
        if str(event_type) != 'interconnect-message':
            return ''

        try:
            request = json.loads(event_payload)
        except Exception:
            print(f'[astramai] 收到非 JSON 消息：{event_payload[:120]}')
            return ''

        try:
            response = await handle_request(request)
        except Exception as error:
            response = {
                'id': request.get('id', ''),
                'ok': False,
                'message': f'插件内部错误：{error}',
            }

        try:
            devices = await host_device.get_connected_device_list()
            if devices:
                await send_to_watch(devices[0].addr, response)
        except Exception as error:
            print(f'[astramai] 回包失败：{error}')

        return ''

    async def on_ui_event(self, event_id, event, event_payload):
        if str(event_id) != 'retest':
            return ''

        await refresh_state()
        devices = await load_devices()
        for item in devices:
            try:
                await host_register.register_interconnect_recv(item.addr, WATCH_PACKAGE)
                print(f'[astramai] 重新订阅 {item.name}')
            except Exception as error:
                print(f'[astramai] 重新订阅 {item.addr} 失败：{error}')

        if STATE['element_id']:
            ui.render(STATE['element_id'], build_ui())
        return ''

    async def on_ui_render(self, element_id):
        """
        画界面。

        ⚠️ 这个函数**必须**调 `ui.render`，否则宿主会一直等。
        """
        STATE['element_id'] = element_id
        await refresh_state()
        await load_devices()
        ui.render(element_id, build_ui())

    async def on_card_render(self, card_id):
        ui.render_to_text_card(card_id, f'AstraMai 网桥 · {STATE["network_text"]}')

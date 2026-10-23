"""
AstraMai · AstroBox 网桥插件

把「手表上的 AstraMai」和「我们的查分服务器」接起来。

────────────── 为什么需要它 ──────────────────────────────────────────

手环（比如小米手环 10 Pro）的 Vela 运行时**没有网络能力**，
它只能用蓝牙跟手机/电脑通信。

AstroBox 桌面版（Tauri）跑在电脑上，插件在里面跑 —— 于是链路是：

    Vela App（@system.interconnect，发 JSON 字符串）
         ↕
    AstroBox 插件（本文件，跑在电脑上，能上网）
         ↕ HTTP
    我们的服务器

手表（REDMI Watch 5 eSIM）自己能上网，不需要这个插件。

────────────── 关键接口（都来自宿主 WIT）────────────────────────────

    register.register_interconnect_recv(addr, pkg)   订阅某个快应用的消息
    interconnect.send_qaic_message(addr, pkg, data)  往快应用发字符串
    Event.on_event('interconnect-message', payload)  收到消息
    ui.render(element_id, element_tree)              画界面

`transport` 接口在宿主里是**占位状态**，官方明写不要当数据通道用。

────────────── 网络这一层踩过的坑（重要）──────────────────────────────

**不能用 `urllib` / `http.client` / `socket.create_connection`。**
它们全都会走 `getaddrinfo`，而 WASI 的 `getaddrinfo` 是个不通的桩：

    gaierror: [Errno -4] Non-recoverable error

明明是 IP 字面量（`101.132.148.117`），压根不需要解析域名，照样炸。

唯一能用的是 `sock.connect((ip, port))` —— CPython 对数字地址会先试
`inet_pton`，成功就直接用，不查 DNS。

所以下面手写了一个最小的 HTTP/1.0 客户端。**改网络部分时别退回去用 urllib。**

────────────── 安全边界 ──────────────────────────────────────────────

**插件里不碰任何上游密钥。** 它只把请求转发到我们自己的服务器，
密钥始终只在服务端（`apps/server` 的设计没变）。
"""

import json
import socket
import urllib.parse

import wit_world.exports as exports
from wit_world.imports import device as host_device
from wit_world.imports import interconnect as host_interconnect
from wit_world.imports import register as host_register
from wit_world.imports import ui

# ── 配置 ──────────────────────────────────────────────────────────────

#: 我们自己的查分服务器。
#: ⚠️ 改这里要同步改 `apps/vela/src/common/config.js` 的默认地址。
#: ⚠️ 必须是 **http + IP 字面量**（不支持 https，也不支持域名），原因见文件头。
SERVER_BASE = 'http://101.132.148.117:8787'

#: 手表上 AstraMai 的快应用包名。必须和服务端/清单里一致。
WATCH_PACKAGE = 'com.astranexus.astramai'

#: 单条 interconnect 消息的字符上限。
#:
#: 手表那边要按同样的值拼回来。**这个值不能随便调大**——
#: 一次 B50 大概十几 KB，蓝牙消息有实际长度限制，
#: 而且太大时手表侧拼接更容易出错。1800 是个保守值。
CHUNK_SIZE = 1800

#: 查服务器时的超时（秒）。
HTTP_TIMEOUT = 15

#: 自检的超时。比 HTTP_TIMEOUT 短 —— 界面不能等 15 秒还白屏。
PROBE_TIMEOUT = 6

#: 请求服务器时带的 UA，方便在服务端日志里认出来。
HTTP_USER_AGENT = 'AstraMaiBridge/0.1 (AstroBox)'


# ── 最小 HTTP 客户端 ──────────────────────────────────────────────────


def _parse_endpoint():
    """从 `SERVER_BASE` 拆出 `(host, port, base_path)`。"""
    parsed = urllib.parse.urlsplit(SERVER_BASE)
    host = parsed.hostname or ''
    port = parsed.port or 80
    base_path = parsed.path.rstrip('/')
    return host, port, base_path


def http_get(path, timeout=HTTP_TIMEOUT):
    """手写的最小 HTTP GET。返回 `(status, body_text)`。

    用 **HTTP/1.0**：那个版本不许用 chunked 编码，响应要么带
    `Content-Length`、要么直接读到 EOF —— 两种都不用解析分块。
    """
    host, port, base_path = _parse_endpoint()
    target = base_path + path

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        # ⚠️ 这里**必须**传数字 tuple。传主机名会退回 getaddrinfo，就又炸了。
        sock.connect((host, port))
        request = (
            f'GET {target} HTTP/1.0\r\n'
            f'Host: {host}:{port}\r\n'
            f'User-Agent: {HTTP_USER_AGENT}\r\n'
            'Accept: application/json\r\n'
            'Connection: close\r\n'
            '\r\n'
        )
        sock.sendall(request.encode('ascii'))

        chunks = []
        while True:
            data = sock.recv(8192)
            if not data:
                break
            chunks.append(data)
    finally:
        sock.close()

    raw = b''.join(chunks)
    head, _, body = raw.partition(b'\r\n\r\n')

    # 状态行：`HTTP/1.0 200 OK`
    status_line = head.split(b'\r\n', 1)[0].decode('latin-1', errors='replace')
    parts = status_line.split(' ')
    status = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0

    return status, body.decode('utf-8', errors='replace')


def fetch_json(path, timeout=HTTP_TIMEOUT):
    """GET 我们服务器的某个路径，返回 `(ok, data_or_error)`。

    服务端的信封是 `{ ok, success, data, error?, message? }`。
    """
    try:
        status, text = http_get(path, timeout=timeout)
    except Exception as error:
        # 带上异常类型 —— 只有 str(error) 时分不清是 gaierror 还是别的
        return False, {'message': f'{type(error).__name__}: {error}'}

    if status == 0:
        return False, {'message': '服务器返回了不是 HTTP 的东西'}

    try:
        parsed = json.loads(text)
    except Exception:
        snippet = text[:120].replace('\n', ' ')
        return False, {'message': f'HTTP {status}，但响应不是 JSON：{snippet}'}

    if status >= 400 or parsed.get('ok') is False:
        # 服务端的错误信封里 `message` 有时候是个**对象**
        # （`{kind, message, friendlyMessage}`），直接原样转发给手表不好看。
        raw = parsed.get('message') or parsed.get('error') or f'HTTP {status}'
        if isinstance(raw, dict):
            raw = raw.get('friendlyMessage') or raw.get('message') or f'HTTP {status}'
        return False, {'message': str(raw)}

    return True, parsed


# ── 界面状态 ──────────────────────────────────────────────────────────
#
# 模块级变量：`on_load`、`on_ui_render`、`on_ui_event` 都要读写它。
# 用 dict 而不是分散的全局变量，省得漏改。

STATE = {
    #: 自检结果：None 表示还没测过
    'network_ok': None,
    #: 自检的说明文字
    'network_text': '还没检测',
    #: 已订阅的设备名，空表示没有
    'devices': [],
    #: 最近一次渲染容器 id（重绘时要它）
    'element_id': '',
}


def probe_network(timeout=PROBE_TIMEOUT):
    """分两段探测：**先 TCP，再 HTTP**，把结果写进 STATE。

    为什么要分两段：插件跑在 CPython-on-WASI 里，能出问题的地方有两层——

      · `wasi:sockets` 没实现     → TCP 就建立不起来
      · TCP 通了但 HTTP/codec 有问题 → TCP 通、HTTP 失败

    合成一句"连不上服务器"的话这两层分不清，每次都要猜。

    返回 `(ok, text)`。
    """
    host, port, _ = _parse_endpoint()

    # ① TCP
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            sock.connect((host, port))
        finally:
            sock.close()
    except Exception as error:
        return False, f'TCP 连不上 {host}:{port}（{type(error).__name__}: {error}）'

    # ② HTTP
    try:
        status, text = http_get('/api/health', timeout=timeout)
    except Exception as error:
        return False, f'TCP 通，但 HTTP 失败（{type(error).__name__}: {error}）'

    if status != 200:
        return False, f'TCP 通，但 /api/health 返回 HTTP {status}'

    try:
        mode = (json.loads(text).get('data') or {}).get('mode', '?')
    except Exception:
        mode = '?'

    return True, f'TCP 通，HTTP 通（mode={mode}）'


def refresh_state():
    """重测网络，更新 STATE。"""
    ok, text = probe_network()
    STATE['network_ok'] = ok
    STATE['network_text'] = text
    print(f'[astramai] 自检 {"✅" if ok else "❌"} {text}')
    return ok


async def load_devices():
    """读当前已连接的设备，顺手填 STATE。"""
    try:
        devices = await host_device.get_connected_device_list()
    except Exception as error:
        print(f'[astramai] 取设备列表失败：{error}')
        STATE['devices'] = []
        return []
    STATE['devices'] = [f'{item.name}' for item in devices]
    return devices


# ── 传输层：给手表发数据 ──────────────────────────────────────────────


async def send_to_watch(address, payload):
    """把一段 JSON 发给手表。

    超过 `CHUNK_SIZE` 时**分片发送**：每片带 `seq` / `total`，
    手表那边按 `id` 收齐再拼。

    分片是必须的 —— 一份 B50 的 JSON 有十几 KB，单条消息大概率塞不下，
    而宿主不会告诉我们上限是多少。
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


def handle_request(payload):
    """把快应用的请求翻译成一次服务端调用。

    请求：`{ "id": "...", "action": "b50", "game": "maimai", "code": "..." }`
    响应：`{ "id": "...", "ok": true, "data": <服务端 data> }`
    """
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

    ok, body = fetch_json(path)
    if not ok:
        message = body.get('message') if isinstance(body, dict) else str(body)
        return {'id': request_id, 'ok': False, 'message': message or '查询失败'}

    return {'id': request_id, 'ok': True, 'data': body.get('data')}


# ── 界面 ──────────────────────────────────────────────────────────────


def build_ui():
    """构建界面树。

    ⚠️ **必须真的 render 点东西。** 之前 `on_ui_render` 直接 return，
    宿主的窗口就永远停在「等待插件响应渲染请求…」——
    用户看到的是卡死，而不是"这个插件没有界面"。
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
        """
        插件加载时：**联网自检** + 订阅手表消息。

        自检决定了整个方案成不成立 —— 即使手表端一行代码都没写，
        也能凭这一条判断去留。
        """
        refresh_state()

        devices = await load_devices()
        if not devices:
            print('[astramai] 现在没有已连接的设备——连上手表后点「重新检测」')
            return

        for item in devices:
            try:
                await host_register.register_interconnect_recv(item.addr, WATCH_PACKAGE)
                print(f'[astramai] 已订阅 {item.name} ({item.addr})')
            except Exception as error:
                print(f'[astramai] 订阅 {item.addr} 失败：{error}')


class Event(exports.Event):
    async def on_event(self, event_type, event_payload):
        """处理宿主派发的事件。

        `interconnect-message` 的 payload 就是快应用发过来的**原样字符串**。
        """
        if str(event_type) != 'interconnect-message':
            return ''

        try:
            request = json.loads(event_payload)
        except Exception:
            print(f'[astramai] 收到非 JSON 消息：{event_payload[:120]}')
            return ''

        try:
            response = handle_request(request)
        except Exception as error:
            response = {
                'id': request.get('id', ''),
                'ok': False,
                'message': f'插件内部错误：{error}',
            }

        # 回包发给**第一台已连接的设备**。
        # interconnect 的事件载荷不带地址，多设备场景没法区分，先这样。
        try:
            devices = await host_device.get_connected_device_list()
            if devices:
                await send_to_watch(devices[0].addr, response)
        except Exception as error:
            print(f'[astramai] 回包失败：{error}')

        return ''

    async def on_ui_event(self, event_id, event, event_payload):
        """界面上的点击。

        `event_id` 就是 `.on(ui.Event.CLICK, '<这个 id>')` 里那个字符串。
        """
        if str(event_id) != 'retest':
            return ''

        refresh_state()
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

        ⚠️ 这个函数**必须**调 `ui.render`。什么都不做就返回的话，
        宿主会一直停在「等待插件响应渲染请求…」—— 用户看到的是卡死。
        """
        STATE['element_id'] = element_id

        # 打开界面时重测一次，保证看到的是当前状态
        refresh_state()
        await load_devices()

        ui.render(element_id, build_ui())

    async def on_card_render(self, card_id):
        ui.render_to_text_card(
            card_id,
            f'AstraMai 网桥 · {STATE["network_text"]}',
        )

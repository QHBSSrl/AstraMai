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

────────────── 安全边界 ──────────────────────────────────────────────

**插件里不碰任何上游密钥。** 它只把请求转发到我们自己的服务器，
密钥始终只在服务端（`apps/server` 的设计没变）。
"""

import json
import urllib.error
import urllib.parse
import urllib.request

import wit_world.exports as exports
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
#: 一次 B50 大概十几 KB，蓝牙消息有实际长度限制，
#: 而且太大时手表侧拼接更容易出错。1800 是个保守值。
CHUNK_SIZE = 1800

#: 查询服务器时的超时（秒）。
HTTP_TIMEOUT = 15

#: 自检的超时。比 HTTP_TIMEOUT 短 —— 界面不能等 15 秒还白屏。
PROBE_TIMEOUT = 6


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
    """打一次 `/api/health`，把结果写进 STATE。

    为什么用 `/api/health`：它在服务端的**免鉴权白名单**里
    （见 `apps/server/src/guard.ts` 的 OPEN_PATHS），不需要令牌。

    ⚠️ 这个函数存在的意义不是"健康检查"，是**验证插件能不能上网**。
    宿主 WIT 里没有任何网络接口，插件能上网靠的是 CPython 的 WASI 运行时
    自带的 `wasi:http` / `wasi:sockets`。产物里确实 import 了它们，
    但**宿主要实现才能用** —— 所以必须真打一次才知道。

    返回 `(ok, text)`。
    """
    url = SERVER_BASE.rstrip('/') + '/api/health'
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body = response.read().decode('utf-8', errors='replace')
        try:
            parsed = json.loads(body)
            data = parsed.get('data') or {}
            mode = data.get('mode', '?')
        except Exception:
            mode = '?'
        return True, f'网络正常（mode={mode}）'
    except urllib.error.HTTPError as error:
        return False, f'服务器返回 HTTP {error.code}'
    except urllib.error.URLError as error:
        return False, f'连不上服务器：{error.reason}'
    except Exception as error:
        return False, f'出错：{error}'


def refresh_state():
    """重测网络 + 读设备列表，更新 STATE。"""
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


# ── 服务端调用 ────────────────────────────────────────────────────────


def fetch_json(path):
    """GET 我们服务器的某个路径，返回 `(ok, data_or_error)`。

    ⚠️ **只用标准库的 urllib。** 插件跑在 CPython-on-WASI 里，
    第三方 HTTP 库（requests 之类）打不进来。
    """
    url = SERVER_BASE.rstrip('/') + path
    try:
        with urllib.request.urlopen(url, timeout=HTTP_TIMEOUT) as response:
            return True, json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        try:
            parsed = json.loads(error.read().decode('utf-8'))
        except Exception:
            parsed = {'message': f'HTTP {error.code}'}
        return False, parsed
    except urllib.error.URLError as error:
        return False, {'message': f'连不上服务器：{error.reason}'}
    except Exception as error:
        return False, {'message': str(error)}


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

    data = body.get('data') if isinstance(body, dict) else None
    return {'id': request_id, 'ok': True, 'data': data}


# ── 界面 ──────────────────────────────────────────────────────────────


def build_ui(height):
    """构建界面树。

    三块：状态（网络 / 设备）、说明、按钮。

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

    # 第一块：网络（最关键的一条）
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

    # 第二块：手表的连接情况
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

    # 服务器地址，方便用户确认打到哪去了
    server = ui.Element(ui.ElementType.P, f'服务器：{SERVER_BASE}')
    server.text_color('#6d7fa3')
    root.child(server)

    # 按钮：重测 + 重新订阅
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

        自检是这里最重要的事 —— 它决定了整个方案成不成立。
        即使手表端一行代码都还没写，也能凭这一条日志判断去留。
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

        # 重测网络、重新读设备、重新订阅
        refresh_state()
        devices = await load_devices()
        for item in devices:
            try:
                await host_register.register_interconnect_recv(item.addr, WATCH_PACKAGE)
                print(f'[astramai] 重新订阅 {item.name}')
            except Exception as error:
                print(f'[astramai] 重新订阅 {item.addr} 失败：{error}')

        # 重绘
        if STATE['element_id']:
            ui.render(STATE['element_id'], build_ui(0))
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

        ui.render(element_id, build_ui(0))

    async def on_card_render(self, card_id):
        ui.render_to_text_card(
            card_id,
            f'AstraMai 网桥 · {STATE["network_text"]}',
        )

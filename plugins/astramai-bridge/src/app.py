"""
AstraMai · AstroBox 网桥插件

把「手表上的 AstraMai」和「我们的查分服务器」接起来。

────────────── 为什么需要它 ──────────────────────────────────────────

手环（比如小米手环 10 Pro）的 Vela 运行时**没有网络能力**：
它只能用蓝牙跟手机通信。而手表（REDMI Watch 5 eSIM）自己能上网，
不需要这个插件。

AstroBox 装在手机上，插件跑在 AstroBox 里 —— 于是链路是：

    Vela App（@system.interconnect，发 JSON 字符串）
         ↕
    AstroBox 插件（本文件，跑在手机上，能上网）
         ↕ HTTPS
    我们的服务器

────────────── 关键接口（都来自宿主 WIT）────────────────────────────

    register.register_interconnect_recv(addr, pkg)   订阅某个快应用的消息
    interconnect.send_qaic_message(addr, pkg, data)  往快应用发字符串
    Event.on_event('interconnect-message', payload)  收到消息

注意 `transport` 接口在宿主里是**占位状态**，官方明写不要当数据通道用。
应用层通信要走 interconnect。

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

# ── 配置 ──────────────────────────────────────────────────────────────

#: 我们自己的查分服务器。
#: ⚠️ 改这里要同步改 `apps/vela/src/common/config.js` 的默认地址。
SERVER_BASE = 'http://101.132.148.117:8787'

#: 手表上 AstraMai 的快应用包名。必须和服务端/清单里一致。
WATCH_PACKAGE = 'com.astranexus.astramai'

#: 单条 interconnect 消息的字符上限。
#:
#: 手表那边要按同样的值拼回来。**这个值不能随便调大**——
#: 一次 B50 大概十几 KB，如果单条能塞下当然好，但蓝牙消息有实际长度限制，
#: 而且太大时手表侧拼接更容易出错。1800 是个保守值。
CHUNK_SIZE = 1800

#: 请求服务器的超时（秒）。手表那边会等，不能让它等太久。
HTTP_TIMEOUT = 15


# ── 传输层：给手表发数据 ──────────────────────────────────────────────


async def send_to_watch(address: str, payload: dict) -> None:
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
        frame = {
            'id': request_id,
            'seq': seq,
            'total': total,
            'chunk': chunk,
        }
        await host_interconnect.send_qaic_message(
            address, WATCH_PACKAGE, json.dumps(frame, ensure_ascii=False)
        )


# ── 服务端调用 ────────────────────────────────────────────────────────


def fetch_json(path: str) -> tuple[bool, object]:
    """GET 我们服务器的某个路径，返回 `(ok, data_or_error)`。

    ⚠️ **只用标准库的 urllib。** Python 插件跑在 CPython-on-WASI 里，
    第三方 HTTP 库（requests 之类）打不进来，而且也没必要。
    """
    url = SERVER_BASE.rstrip('/') + path
    try:
        with urllib.request.urlopen(url, timeout=HTTP_TIMEOUT) as response:
            body = response.read().decode('utf-8')
        return True, json.loads(body)
    except urllib.error.HTTPError as error:
        # 服务端用 4xx/5xx 表达业务错误，body 里通常有 message
        try:
            body = error.read().decode('utf-8')
            parsed = json.loads(body)
        except Exception:
            parsed = {'message': f'HTTP {error.code}'}
        return False, parsed
    except urllib.error.URLError as error:
        return False, {'message': f'连不上服务器：{error.reason}'}
    except Exception as error:  # 超时、JSON 解析失败等
        return False, {'message': str(error)}


# ── 请求路由 ──────────────────────────────────────────────────────────


def handle_request(payload: dict) -> dict:
    """把快应用的请求翻译成一次服务端调用。

    请求：`{ "id": "...", "action": "b50", "game": "maimai", "code": "..." }`
    响应：`{ "id": "...", "ok": true, "data": <服务端 data> }`
    """
    request_id = payload.get('id', '')
    action = payload.get('action', '')

    if action == 'ping':
        # 手表用它验证链路是否通 —— 不碰网络，最快
        return {'id': request_id, 'ok': True, 'data': {'pong': True}}

    if action != 'b50':
        return {'id': request_id, 'ok': False, 'message': f'未知操作：{action}'}

    game = payload.get('game', 'maimai')
    code = str(payload.get('code', '')).strip()
    if not code:
        return {'id': request_id, 'ok': False, 'message': '缺少查询目标'}

    # 组装我们服务器的路径。参数名要和 apps/server 的路由对齐。
    if game == 'chunithm':
        path = f'/api/v1/chunithm/bests?code={urllib.parse.quote(code)}'
    else:
        path = f'/api/v1/maimai/b50?code={urllib.parse.quote(code)}'

    ok, body = fetch_json(path)
    if not ok:
        message = body.get('message') if isinstance(body, dict) else str(body)
        return {'id': request_id, 'ok': False, 'message': message or '查询失败'}

    # 服务端的信封是 { ok, success, data, ... }，只把 data 转发给手表
    data = body.get('data') if isinstance(body, dict) else None
    return {'id': request_id, 'ok': True, 'data': data}


# ── 生命周期 ──────────────────────────────────────────────────────────


class Lifecycle(exports.Lifecycle):
    async def on_load(self) -> None:
        """
        插件加载时做两件事：**联网自检**、订阅手表消息。

        ── 为什么要自检 ────────────────────────────────────────────────

        宿主 WIT 里**没有网络接口**，插件能上网这件事靠的是 CPython 的
        WASI 运行时自带的 `wasi:http` / `wasi:sockets`。产物里确实
        import 了它们，但**宿主要实现它们才能用**——这在真机上才知道。

        而 `wasi:http` 用不了的话，这个插件就完全没意义。
        所以装完第一件事就是打一次 `/api/health`（免鉴权），
        把结果打进日志。**看一眼日志就知道这条路通不通。**

        ── 订阅为什么要逐个 try ────────────────────────────────────────

        只订阅**已连接**的设备。没连接时订阅会失败，
        所以一个设备失败不能影响其它设备，也不能拖累自检。
        """
        # ① 联网自检
        ok, body = fetch_json('/api/health')
        if ok:
            status = body.get('status') if isinstance(body, dict) else body
            print(f'[astramai] ✅ 网络可用（/api/health: {status}）')
        else:
            message = body.get('message') if isinstance(body, dict) else str(body)
            print(f'[astramai] ❌ 网络不可用：{message}')

        # ② 订阅手表消息
        try:
            devices = await host_device.get_connected_device_list()
        except Exception as error:
            print(f'[astramai] 取设备列表失败：{error}')
            return

        if not devices:
            print('[astramai] 现在没有已连接的设备——连上手表后需要重新加载插件')
            return

        for item in devices:
            try:
                await host_register.register_interconnect_recv(item.addr, WATCH_PACKAGE)
                print(f'[astramai] 已订阅 {item.name} ({item.addr})')
            except Exception as error:
                print(f'[astramai] 订阅 {item.addr} 失败：{error}')


class Event(exports.Event):
    async def on_event(self, event_type, event_payload: str) -> str:
        """处理宿主派发的事件。

        `interconnect-message` 的 payload 就是快应用发过来的**原样字符串**。
        """
        if str(event_type) != 'interconnect-message':
            return ''

        try:
            request = json.loads(event_payload)
        except Exception:
            # 收到不是 JSON 的东西，记一笔就走 —— 不要抛，抛了会打断事件循环
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

        # 回包要发给**发消息的那台设备**。单设备场景下取第一台就够；
        # 多设备时应该按 payload 里的地址区分，但当前 interconnect 的
        # 事件载荷不带地址，所以先这样。
        try:
            devices = await host_device.get_connected_device_list()
            if devices:
                await send_to_watch(devices[0].addr, response)
        except Exception as error:
            print(f'[astramai] 回包失败：{error}')

        return ''

    async def on_ui_event(self, event_id: str, event, event_payload: str) -> str:
        return ''

    async def on_ui_render(self, element_id: str) -> None:
        # 这个插件没有配置界面。要不要加，等验证过链路再说。
        return None

    async def on_card_render(self, card_id: str) -> None:
        return None

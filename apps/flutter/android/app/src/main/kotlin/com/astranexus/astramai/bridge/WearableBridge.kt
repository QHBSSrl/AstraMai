package com.astranexus.astramai.bridge

import android.content.Context
import android.util.Base64
import android.util.Log
import com.xiaomi.xms.wearable.Wearable
import com.xiaomi.xms.wearable.auth.Permission
import com.xiaomi.xms.wearable.message.OnMessageReceivedListener
import com.xiaomi.xms.wearable.node.Node
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 手机端网桥。
 *
 * ── 它干什么 ────────────────────────────────────────────────────────
 *
 * 手环 Pro / 手表没有 `@system.fetch`，自己上不了网。
 * 手表把「帮我请求这个 URL」通过 interconnect 发过来，
 * 我们在手机上真的发一个 HTTP，把结果分片送回去。
 *
 * ```
 * 手表  ──{tag:'fetch', url}──▶  手机  ──HTTP──▶  服务器
 *       ◀─{tag:'fetch-stream'}──       ◀─────────
 * ```
 *
 * ── 前置条件（缺一个就静默失败）────────────────────────────────────
 *
 * 1. 快应用 `package` = 本 App 包名（`com.nowmes.orhythm.band`）
 * 2. 快应用和本 App **用同一张证书签名**（见 key.properties 的注释）
 * 3. 手机上装了「小米运动健康」（`com.xiaomi.wearable`）
 * 4. 手表和手机已配对连接
 *
 * 第 2 条是最容易踩的 —— 不满足时连接直接被拒，现象是「握手超时」。
 */
class WearableBridge(private val context: Context) {

    companion object {
        private const val TAG = "AstraMaiBridge"

        /** 一次请求的超时。手表那边也有自己的超时，取小的那个生效。 */
        private const val HTTP_TIMEOUT_MS = 15_000
    }

    /** 桥的状态，给 Flutter 展示。 */
    enum class State { STOPPED, WAITING_NODE, CONNECTED, ERROR }

    private val io = Executors.newSingleThreadExecutor()
    private val running = AtomicBoolean(false)

    private var nodeId: String? = null

    /** 对端在握手里声明的 maxChunkSize，决定我们分片多大。 */
    private var peerChunkBytes: Int = BridgeProtocol.CHUNK_BYTES

    /**
     * 对端支不支持「分片流」。
     *
     * 手表默认 MODE.SINGLE，握手里声明 chunk: false ——
     * 那时它**期望响应体直接放在 esp.body 里**，不接受分帧。
     * 一律按流式回帧，它就不认，表现是同一个请求反复重试。
     */
    private var peerStream: Boolean = false

    /** 连接的手表名，给界面显示用。 */
    var nodeName: String? = null
        private set

    var state: State = State.STOPPED
        private set

    var lastError: String? = null
        private set

    /** 状态变了通知 Flutter。 */
    var onStateChanged: ((State, String?) -> Unit)? = null

    // ── 生命周期 ────────────────────────────────────────────────────────

    fun start() {
        if (!running.compareAndSet(false, true)) return
        update(State.WAITING_NODE, null)
        findNode()
    }

    fun stop() {
        if (!running.compareAndSet(true, false)) return

        val id = nodeId
        nodeId = null
        nodeName = null
        if (id != null) {
            runCatching { Wearable.getMessageApi(context).removeListener(id) }
        }
        update(State.STOPPED, null)
    }

    /**
     * 找一个已连接的手表，并且注册消息监听。
     *
     * ⚠️ `getConnectedNodes()` 在手表还没连上时返回**空列表**而不是报错，
     * 所以这里要轮询 —— 不能只调一次就以为没设备。
     */
    private fun findNode() {
        Wearable.getNodeApi(context).getConnectedNodes()
            .addOnSuccessListener { nodes: List<Node> ->
                if (!running.get()) return@addOnSuccessListener

                val node = nodes.firstOrNull()
                if (node == null) {
                    update(State.WAITING_NODE, "没有已连接的手表")
                    // 3 秒后再试
                    io.execute {
                        Thread.sleep(3000)
                        if (running.get()) findNode()
                    }
                    return@addOnSuccessListener
                }

                attach(node)
            }
            .addOnFailureListener { e ->
                Log.w(TAG, "getConnectedNodes 失败", e)
                update(State.ERROR, explain(e))
                if (running.get()) {
                    io.execute {
                        Thread.sleep(3000)
                        if (running.get()) findNode()
                    }
                }
            }
    }

    private fun attach(node: Node) {
        nodeName = node.name
        Log.i(TAG, "找到设备 ${node.name} (${node.id})")

        // 先查权限，没有再申请
        Wearable.getAuthApi(context)
            .checkPermission(node.id, Permission.DEVICE_MANAGER)
            .addOnSuccessListener { granted: Boolean ->
                if (granted) {
                    Log.i(TAG, "权限已有")
                    registerListener(node.id)
                } else {
                    /*
                     * ⚠️ **权限不会自己来，必须 requestPermission。**
                     *
                     * 只 check 不 request 的话永远是「设备管理权限被拒绝」——
                     * 这个错误看起来像用户拒绝了，其实是**我们根本没弹过窗**。
                     */
                    requestPermission(node.id)
                }
            }
            .addOnFailureListener { e ->
                Log.w(TAG, "checkPermission 失败", e)
                update(State.ERROR, explain(e))
            }
    }

    /**
     * 申请设备管理权限。
     *
     * 会弹出系统授权框（手机上确认）。用户同意之后才能收发消息。
     */
    private fun requestPermission(id: String) {
        Log.i(TAG, "申请设备管理权限")
        update(State.WAITING_NODE, "请在手机上允许访问手表")

        Wearable.getAuthApi(context)
            .requestPermission(id, Permission.DEVICE_MANAGER)
            .addOnSuccessListener { granted: Array<Permission> ->
                if (granted.isNotEmpty()) {
                    Log.i(TAG, "权限已授予")
                    registerListener(id)
                } else {
                    Log.w(TAG, "用户拒绝了权限")
                    update(State.ERROR, "没有手表权限。请在「小米运动健康」里允许 ORhythm 访问设备。")
                }
            }
            .addOnFailureListener { e ->
                Log.w(TAG, "requestPermission 失败", e)
                update(State.ERROR, explain(e))
            }
    }

    /**
     * 把 SDK 的异常翻译成用户能看懂的话。
     *
     * ⚠️ `AppNotInstalledException: app not installed` 这句话很容易误导 ——
     * 它说的不是「手机没装小米运动健康」，而是**手表上找不到和本 App
     * 包名一致的那个快应用**。
     *
     * 最常见的原因就是两边包名不一致（比如手机装的是 `.band` 版，
     * 手表上装的还是普通版）。
     */
    private fun explain(e: Throwable): String {
        val text: String = e.message ?: e.javaClass.simpleName

        if (text.contains("app not installed", ignoreCase = true)) {
            val pkg = context.packageName
            return "手表上找不到对应的 AstraMai（包名 " + pkg + "）。" +
                "手机和手表的包名必须完全一致：手环版要装带 .band 的 APK，" +
                "并且手表上也要装 .band 的版本。"
        }
        if (text.contains("permission", ignoreCase = true)) {
            return "权限被拒绝：" + text
        }
        if (text.contains("disconnect", ignoreCase = true)) {
            return "设备已断开：" + text
        }
        return text
    }

    private fun registerListener(id: String) {
        val listener = OnMessageReceivedListener { fromNode, data ->
            if (!running.get()) return@OnMessageReceivedListener
            if (fromNode != id) return@OnMessageReceivedListener

            val text = runCatching { String(data, Charsets.UTF_8) }.getOrNull()
            if (text.isNullOrBlank()) return@OnMessageReceivedListener

            io.execute { handleFrame(id, text) }
        }

        Wearable.getMessageApi(context)
            .addListener(id, listener)
            .addOnSuccessListener {
                nodeId = id
                update(State.CONNECTED, null)
                Log.i(TAG, "监听已注册")
            }
            .addOnFailureListener { e ->
                Log.w(TAG, "addListener 失败", e)
                update(State.ERROR, explain(e))
            }
    }

    // ── 帧处理 ──────────────────────────────────────────────────────────

    private fun handleFrame(id: String, text: String) {
        val frame = runCatching { JSONObject(text) }.getOrNull()
        if (frame == null) {
            Log.w(TAG, "收到非 JSON：${text.take(120)}")
            return
        }

        when (frame.optString("tag")) {
            "__hs__" -> handleHandshake(id, frame)
            "fetch" -> handleFetch(id, frame)
            "fetch-stream-ack" -> {
                // 我们现在是一次性把分片全发出去，不做窗口控制。
                // 手表端也会发 ACK，这里只记日志 —— 以后要做重传再用。
                Log.d(TAG, "ACK id=${frame.optString("id")} ack=${frame.optInt("ack")}")
            }
            else -> Log.d(TAG, "不认识的帧：${frame.optString("tag")}")
        }
    }

    private fun handleHandshake(id: String, frame: JSONObject) {
        val count = frame.optInt("count", 0)

        // 对端声明的分片上限 —— 必须听它的，否则切出来的帧它不收
        val caps = frame.optJSONObject("caps")
        if (caps != null) {
            peerStream = caps.optBoolean("chunk", false) && caps.optBoolean("ack", false)
            Log.i(TAG, "对端分片能力=$peerStream")
        }
        if (caps != null && caps.has("maxChunkSize")) {
            val peer = caps.optInt("maxChunkSize", BridgeProtocol.CHUNK_BYTES)
            peerChunkBytes = BridgeProtocol.chunkBytesFor(peer)
            Log.i(TAG, "对端 maxChunkSize=$peer → 我们用 $peerChunkBytes")
        }

        Log.i(TAG, "握手 count=$count")

        if (count >= BridgeProtocol.HANDSHAKE_ROUNDS) {
            Log.i(TAG, "握手完成")
            return
        }
        send(id, BridgeProtocol.handshakeReply(count + 1))
    }

    private fun handleFetch(id: String, frame: JSONObject) {
        val requestId = frame.optString("id")
        val url = frame.optString("url")
        if (requestId.isEmpty() || url.isEmpty()) {
            Log.w(TAG, "fetch 帧缺 id 或 url")
            return
        }

        val options = frame.optJSONObject("options")
        val method = options?.optString("method")?.takeIf { it.isNotEmpty() } ?: "GET"
        val headers = options?.optJSONObject("headers")
        val body = options?.optString("body")?.takeIf { it.isNotEmpty() }

        Log.i(TAG, "代理请求 $method $url")

        val result = runCatching { performHttp(url, method, headers, body) }

        result.onSuccess { resp ->
            /*
             * ⚠️ **两种响应形态，必须按对端声明的能力选。**
             *
             * 手表默认 `MODE.SINGLE`（`chunk: false`），它期望响应体
             * 直接放在 `resp.body` 里，**不接受分帧**。一律按流式回帧
             * 它就不认 —— 现象是同一个请求反复重试。
             *
             * 只有对端声明了 `chunk:true` + `ack:true` 才走流式。
             */
            if (peerStream) {
                val header = BridgeProtocol.responseHead(
                    id = requestId,
                    ok = resp.status in 200..299,
                    status = resp.status,
                    statusText = resp.statusText,
                    headers = resp.headers,
                    bodyLength = resp.body.size,
                    contentType = resp.headers["content-type"],
                    stream = true,
                )
                send(id, header)
                Log.i(TAG, "已发流式头 id=$requestId status=${resp.status} 长度=${resp.body.size}")

                val frames = BridgeProtocol.chunkResponse(requestId, resp.body, peerChunkBytes) { bytes ->
                    Base64.encodeToString(bytes, Base64.NO_WRAP)
                }
                Log.i(TAG, "分片数=${frames.size} 首帧长度=${frames.firstOrNull()?.length ?: 0}")
                for (f in frames) {
                    send(id, f)
                    Thread.sleep(4)
                }
                Log.i(TAG, "分片发送完毕 id=$requestId")
            } else {
                // 单消息：整个响应体一次发完，base64 内联
                val inline = BridgeProtocol.responseHeadInline(
                    id = requestId,
                    ok = resp.status in 200..299,
                    status = resp.status,
                    statusText = resp.statusText,
                    headers = resp.headers,
                    body = Base64.encodeToString(resp.body, Base64.NO_WRAP),
                )
                Log.i(TAG, "已发单消息响应 id=$requestId status=${resp.status} 原始=${resp.body.size} 帧长=${inline.length}")
                send(id, inline)
            }
        }.onFailure { e ->
            Log.w(TAG, "请求失败", e)
            send(id, BridgeProtocol.errorResponse(requestId, e.message ?: "请求失败"))
        }
    }

    private class HttpResponse(
        val status: Int,
        val statusText: String,
        val headers: Map<String, String>,
        val body: ByteArray,
    )

    private fun performHttp(
        url: String,
        method: String,
        headers: JSONObject?,
        body: String?,
    ): HttpResponse {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = HTTP_TIMEOUT_MS
            readTimeout = HTTP_TIMEOUT_MS
            instanceFollowRedirects = true
            // 有些服务器会拒绝没有 UA 的请求
            setRequestProperty("User-Agent", "AstraMai-Bridge/0.1 (Android)")
        }

        headers?.keys()?.forEach { key ->
            val value = headers.optString(key)
            if (value.isNotEmpty()) conn.setRequestProperty(key, value)
        }

        if (body != null && method != "GET" && method != "HEAD") {
            conn.doOutput = true
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        }

        val status = conn.responseCode
        val stream = if (status >= 400) conn.errorStream else conn.inputStream
        val bytes = stream?.use { it.readBytes() } ?: ByteArray(0)

        val respHeaders = mutableMapOf<String, String>()
        conn.headerFields.forEach { (k, v) ->
            if (k != null) respHeaders[k.lowercase()] = v.joinToString(", ")
        }

        return HttpResponse(status, conn.responseMessage ?: "", respHeaders, bytes)
    }

    /**
     * 发一帧给手表。
     *
     * ⚠️ 消息是 **字节**，UTF-8 JSON。手表端 `onmessage` 拿到的是字符串，
     * 直接 `JSON.parse` —— 两边约定好了，别改成别的编码。
     */
    private fun send(id: String, json: String) {
        val bytes = json.toByteArray(Charsets.UTF_8)
        if (bytes.size > 60 * 1024) {
            Log.w(TAG, "帧太大（${bytes.size} 字节），可能被 interconnect 丢掉")
        }

        Wearable.getMessageApi(context)
            .sendMessage(id, bytes)
            .addOnSuccessListener {
                Log.i(TAG, "sendMessage ok ${bytes.size}B ${json.take(60)}")
            }
            .addOnFailureListener { e ->
                Log.w(TAG, "sendMessage 失败", e)
                update(State.ERROR, explain(e))
            }
    }

    private fun update(next: State, error: String?) {
        state = next
        lastError = error
        onStateChanged?.invoke(next, error)
    }

    /** 给 Flutter 看的一行状态。 */
    fun statusText(): String = when (state) {
        State.STOPPED -> "已停止"
        State.WAITING_NODE -> "等待手表连接"
        State.CONNECTED -> nodeName?.let { "已连接：$it" } ?: "已连接手表"
        State.ERROR -> "出错：${lastError ?: "未知"}"
    }
}

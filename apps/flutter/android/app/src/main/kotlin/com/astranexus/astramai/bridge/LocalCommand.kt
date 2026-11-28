package com.astranexus.astramai.bridge

import android.util.Log
import org.json.JSONObject

/**
 * 本地命令的日志 tag。
 *
 * 不复用 WearableBridge.kt 里的那个 —— 它是文件级 private，改可见性会牵动
 * 那个文件；而且独立一个在日志里能一眼分出来。
 */
private const val LOCAL_TAG = "AstraMaiBridge/Local"

/**
 * `bridge://` 本地命令。
 *
 * ── 为什么需要 ──────────────────────────────────────────────────────
 *
 * 手环没有网络模块，查分靠手机代理（FetchBridge 协议）。但 **Phigros 需要
 * TapTap 登录态**，那个会话存在 Flutter 的 secure storage 里 —— 加密密钥由
 * Dart 侧的插件管理，Kotlin 这边读不到。
 *
 * 所以桥协议加一条约定：URL 以 `bridge://` 开头时**不发 HTTP**，
 * 回调 Flutter，由它用自己的会话查完再返回 JSON。手环看到的响应和普通
 * 接口一模一样，感觉不到区别。
 *
 * ── 和手动分片的区别 ────────────────────────────────────────────────
 *
 * 走**单帧**（`responseHeadInline`），不是流式。
 * 手环默认 `MODE.SINGLE`，期望响应体直接放在 `resp.body`；一律按流式回帧
 * 它不认，现象是同一请求反复重试。查分结果十几 KB，单帧放得下
 * （上限 60 KB，见 `send` 里的检查）。
 */
internal fun WearableBridge.handleLocalCommand(
    nodeId: String,
    requestId: String,
    url: String,
) {
    Log.i(LOCAL_TAG, "本地命令 $url")

    val handler = onLocalCommand
    if (handler == null) {
        sendLocalError(nodeId, requestId, 503, "手机端没有注册本地命令处理器")
        return
    }

    val body = runCatching { handler(url) }.getOrElse { error ->
        Log.w(LOCAL_TAG, "本地命令失败：$url", error)
        sendLocalError(nodeId, requestId, 500, error.message ?: "本地命令执行失败")
        return
    }

    if (body == null) {
        sendLocalError(nodeId, requestId, 504, "手机端没有及时返回（超时）")
        return
    }

    val frame = BridgeProtocol.responseHeadInline(
        id = requestId,
        ok = true,
        status = 200,
        statusText = "OK",
        headers = mapOf("content-type" to "application/json; charset=utf-8"),
        body = body,
    )

    send(nodeId, frame)
    Log.i(LOCAL_TAG, "本地命令响应 id=$requestId 长度=${body.length}")
}

/** 本地命令失败时回一个带错误 JSON 的响应，手环那边能显示具体原因。 */
private fun WearableBridge.sendLocalError(
    nodeId: String,
    requestId: String,
    status: Int,
    message: String,
) {
    val body = JSONObject()
        .put("ok", false)
        .put("success", false)
        .put("message", message)
        .toString()

    val frame = BridgeProtocol.responseHeadInline(
        id = requestId,
        ok = false,
        status = status,
        statusText = "ERROR",
        headers = mapOf("content-type" to "application/json; charset=utf-8"),
        body = body,
    )
    send(nodeId, frame)
}

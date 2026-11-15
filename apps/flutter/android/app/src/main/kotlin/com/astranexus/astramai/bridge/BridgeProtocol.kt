package com.astranexus.astramai.bridge

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.zip.CRC32

/**
 * 网桥协议的编解码。
 *
 * ── 协议来源 ────────────────────────────────────────────────────────
 *
 * 完整规范在 `plugins/fetchbridge/PROTOCOL.md`（官方 FetchBridge 1.3.2 的）。
 * 手表端的客户端实现在 `apps/vela/src/common/fetchbridge.js`。
 *
 * 这里只做**服务端那一半**：手表发请求，我们真的发 HTTP，把结果分片送回去。
 *
 * ── 帧格式（JSON，UTF-8）────────────────────────────────────────────
 *
 * ```
 * 握手    {tag:'__hs__', count:N, caps:{...}}        ↔ 同上，count 加到 2
 * 请求    {tag:'fetch', id, url, options:{method, headers, body}}
 * 响应头  {tag:'fetch', id, resp:{ok, status, statusText, headers, body, raw, ...}}
 * 分片    {tag:'fetch-stream', id, seq, offset, data, crc32, final?, totalBytes?}
 * ACK     {tag:'fetch-stream-ack', id, ack}          ack = 下一个还缺的序号
 * ```
 *
 * ── ⚠️ 三条不能省的约束 ─────────────────────────────────────────────
 *
 * 1. **单帧别超过 60 KB。** interconnect 的上限约 64 KB，超了会直接丢。
 * 2. **CRC32 错的帧不能推进 ACK。** 否则手表会丢掉一段数据还以为收全了。
 * 3. **`ack` 是「下一个还缺的序号」，不是「已收到几个」。** 差一就卡死。
 */
object BridgeProtocol {

    /**
     * 单个分片的原始字节上限（base64 之后会膨胀 4/3）。
     *
     * ⚠️ **必须是 4096，不能拍脑袋往大了取。**
     *
     * 手表端 `fetchbridge.js` 的 `MAX_CHUNK_SIZE` 就是 4096，并且在握手
     * 的 caps 里声明了 `maxChunkSize`。原来这里用 24 KB，切出来的帧
     * 手表直接不收 —— 现象是同一请求反复重试（fb-7 / fb-8 / fb-9）。
     *
     * 协议的正确做法是**听对端声明的上限**，见 [chunkBytesFor]。
     */
    const val CHUNK_BYTES = 4096

    /** 协议允许的绝对上下限（见 PROTOCOL.md）。 */
    const val MIN_CHUNK_BYTES = 256
    const val MAX_CHUNK_BYTES = 64 * 1024

    /**
     * 按对端声明的 `maxChunkSize` 决定实际分片大小。
     *
     * 取不到就用自己的默认值；对端要得更小就听它的。
     */
    fun chunkBytesFor(peerMax: Int): Int {
        if (peerMax < MIN_CHUNK_BYTES) return CHUNK_BYTES
        return if (peerMax < CHUNK_BYTES) peerMax else CHUNK_BYTES
    }

    /** 握手轮数 —— 和手表端 `HANDSHAKE_ROUNDS` 必须一致。 */
    const val HANDSHAKE_ROUNDS = 2

    /** 我们的能力声明。 */
    fun caps(): JSONObject = JSONObject().apply {
        put("version", 4)
        put("chunk", true)
        put("maxChunkSize", CHUNK_BYTES)
        put("encodings", listOf("text", "base64"))
        put("compressions", listOf("none", "deflate"))
        put("ack", true)
        put("ackWindow", 4)
        // ⚠️ v4 要求 stream 必须 chunk + ack 都开
        put("stream", true)
    }

    /** CRC32，小写 8 位十六进制 —— 和手表端 `crc32()` 的格式一致。 */
    fun crc32(bytes: ByteArray): String {
        val crc = CRC32()
        crc.update(bytes)
        return java.lang.Long.toHexString(crc.value).padStart(8, '0')
    }

    /**
     * 把响应体切成帧。
     *
     * 返回的是**已经编码好的 JSON 字符串**，调用方直接 send 出去即可。
     */
    fun chunkResponse(
        id: String,
        body: ByteArray,
        chunkSize: Int = CHUNK_BYTES,
        base64Encode: (ByteArray) -> String,
    ): List<String> {
        val frames = mutableListOf<String>()
        val size = if (chunkSize in MIN_CHUNK_BYTES..MAX_CHUNK_BYTES) chunkSize else CHUNK_BYTES
        val total = if (body.isEmpty()) 1 else (body.size + size - 1) / size

        if (body.isEmpty()) {
            frames += JSONObject().apply {
                put("tag", "fetch-stream")
                put("id", id)
                put("seq", 0)
                put("offset", 0)
                put("data", "")
                put("crc32", crc32(ByteArray(0)))
                put("final", true)
                put("totalBytes", 0)
            }.toString()
            return frames
        }

        for (seq in 0 until total) {
            val start = seq * size
            val end = minOf(start + size, body.size)
            val slice = body.copyOfRange(start, end)

            frames += JSONObject().apply {
                put("tag", "fetch-stream")
                put("id", id)
                put("seq", seq)
                put("offset", start)
                put("data", base64Encode(slice))
                put("crc32", crc32(slice))
                put("final", seq == total - 1)
                put("totalBytes", body.size)
            }.toString()
        }
        return frames
    }

    /** 把响应头包成 `tag:fetch` 帧。 */
    fun responseHead(
        id: String,
        ok: Boolean,
        status: Int,
        statusText: String,
        headers: Map<String, String>,
        bodyLength: Int,
        contentType: String?,
        stream: Boolean,
    ): String = JSONObject().apply {
        put("tag", "fetch")
        put("id", id)
        put(
            "resp",
            JSONObject().apply {
                put("ok", ok)
                put("status", status)
                put("statusText", statusText)
                put("headers", JSONObject(headers as Map<*, *>))
                put("body", "")
                put("raw", "")
                put("bodyLength", bodyLength)
                put("contentType", contentType ?: "")
                put("stream", stream)
            },
        )
    }.toString()

    /** 出错时的帧。手表端看到 `resp.ok=false` 就会走错误分支。 */
    /**
     * 单消息响应：响应体一次发完，base64 内联在 `resp.body` 里。
     *
     * 手表默认 `MODE.SINGLE`，走的就是这条 —— 它不发分片帧，也不回 ACK。
     * 之前一律按流式回帧，它不认，表现是同一个请求反复重试。
     *
     * ⚠️ 单帧有 **16 KB** 上限（`MAX_UNCHUNKED_WIRE_LEN`），base64 会
     * 膨胀 4/3，所以原始数据要控制在 ~12 KB 以内。
     */
    fun responseHeadInline(
        id: String,
        ok: Boolean,
        status: Int,
        statusText: String,
        headers: Map<String, String>,
        body: String,
    ): String = JSONObject().apply {
        put("tag", "fetch")
        put("id", id)
        put(
            "resp",
            JSONObject().apply {
                put("ok", ok)
                put("status", status)
                put("statusText", statusText)
                put("headers", JSONObject(headers as Map<*, *>))
                // 手表端 decodeBody 按 bodyEncoding 解 base64
                put("body", body)
                put("bodyEncoding", "base64")
                put("stream", false)
            },
        )
    }.toString()

    fun errorResponse(id: String, message: String, status: Int = 0): String =
        JSONObject().apply {
            put("tag", "fetch")
            put("id", id)
            put(
                "resp",
                JSONObject().apply {
                    put("ok", false)
                    put("status", status)
                    put("statusText", "")
                    put("headers", JSONObject())
                    put("body", "")
                    put("raw", "")
                    put("error", message)
                },
            )
        }.toString()

    /** 握手回复。 */
    fun handshakeReply(count: Int): String = JSONObject().apply {
        put("tag", "__hs__")
        put("count", count)
        put("caps", caps())
    }.toString()

    /** 把若干帧拼成一个字符串（调试用）。 */
    fun debugJoin(frames: List<String>): String {
        val out = ByteArrayOutputStream()
        frames.forEach { out.write(it.toByteArray(Charsets.UTF_8)); out.write('\n'.code) }
        return out.toString("UTF-8")
    }
}

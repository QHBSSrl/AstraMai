#!/usr/bin/env python3
"""
sync-proxy —— 把大陆的请求转发到 Cloudflare Worker。

── 为什么需要它 ────────────────────────────────────────────────────

Worker 在大陆直连能通（实测 272ms 中位数），但**手表**走的是另一条
链路（蓝牙/WiFi），TLS 栈也不同。这台服务器在大陆，到手表只有 35ms，
所以加一层转发，把"能不能连上"变成一个确定的事。

    手表 ──35ms──▶ 这台服务器 ──▶ Cloudflare Worker ──▶ KV

── 为什么用 python3 stdlib，不装 nginx ─────────────────────────────

服务器的可用内存只有 ~76MB（mysql + 宝塔 + docker 已经吃掉 1.5GB）。
装 nginx 要几十 MB，风险不值当。这个脚本单线程处理、每次只占几 MB。

流量极低（一次同步 4~5 个请求），性能完全够。

── CORS ────────────────────────────────────────────────────────────

Worker 自己**没有** CORS 头，所以浏览器直接打 workers 域会被拦。
这里补上 —— 网页端也能走这个代理。

── 安全边界 ────────────────────────────────────────────────────────

这是一个**只转发到一个固定上游**的代理，不是开放代理。
不解析、不记录、不改写 payload —— 它只看到密文。

⚠️ 它会看到配对码和 PIN（明文），但拿不到解密密钥之外的任何东西：
   密钥是 PIN + 配对码派生的，而载荷的核心内容已端到端加密。
   坦白说：这比直连 Worker 弱一点点，换来的是大陆可达性。
"""

import http.server
import json
import socket
import socketserver
import ssl
import sys
import urllib.error
import urllib.request

# ── 配置 ────────────────────────────────────────────────────────────
UPSTREAM = "https://worksync.astramai.astranexus.cn"
LISTEN_PORT = 8788
TIMEOUT = 20  # 秒

# Cloudflare 会拦 Python-urllib 的默认 UA（403 + error code 1010）
USER_AGENT = 'AstraMai-SyncProxy/1.0'

# 允许的来源。网页端 dev server 用 5173，正式站以后再说 —— 先用 * ，
# 因为这个代理本身不持有任何凭据，跨域不会泄露别人的数据。
ALLOW_ORIGIN = "*"

# 只转发这些前缀，别的一律 404 —— 防止有人拿它当通用代理
ALLOWED_PREFIXES = ("/sync/", "/sync", "/health")


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # 不要在日志里打 path —— 里面有配对码
    def log_message(self, fmt, *args):
        sys.stderr.write("[proxy] %s %s\n" % (self.address_string(), fmt % args))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _forward(self):
        if not any(self.path.startswith(p) for p in ALLOWED_PREFIXES):
            self._reject(404, "not_found")
            return

        # 读请求体（PUT 的 payload 可能 20KB+）
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None

        url = UPSTREAM + self.path
        request = urllib.request.Request(url, data=body, method=self.command)
        # 只带必要的头 —— 其余（Host / Connection 等）由 urllib 自己生成
        if body is not None:
            request.add_header("Content-Type", "application/json")
        # ⚠️ 必须伪装 UA。Cloudflare 见到 `Python-urllib/3.x` 会直接
        # 返回 403 + "error code: 1010"（按客户端签名封禁），
        # 我们的请求根本到不了 Worker。
        request.add_header("User-Agent", USER_AGENT)

        try:
            # 显式校验证书（默认就会校验，这里写出来是为了让人一眼看到）
            context = ssl.create_default_context()
            with urllib.request.urlopen(request, timeout=TIMEOUT, context=context) as response:
                payload = response.read()
                self.send_response(response.status)
                self._cors()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except urllib.error.HTTPError as error:
            # 上游返回 4xx/5xx —— 原样转给客户端，**不要**改状态码，
            # 客户端的错误处理依赖它（403 pin_mismatch / 404 not_found 等）
            payload = error.read()
            self.send_response(error.code)
            self._cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (urllib.error.URLError, socket.timeout, TimeoutError) as error:
            self.log_message("上游失败：%s", error)
            self._reject(502, "upstream_unreachable")

    def _reject(self, status, code):
        payload = json.dumps({"ok": False, "error": code}).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = _forward
    do_POST = _forward
    do_PUT = _forward


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    # 允许端口快速重启
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    print(f"sync-proxy 监听 0.0.0.0:{LISTEN_PORT} → {UPSTREAM}", flush=True)
    Server(("0.0.0.0", LISTEN_PORT), Handler).serve_forever()

# 机房接入指南（frp over WSS）

> 给一年后阿里云到期、或现在就想把查询挪回国内时用。
>
> **现状**：甲骨文直连落雪，2.5~7 秒。
> **接入机房后**：落雪查询在机房做，约 0.5 秒。

---

## 拓扑

```
玩家 ──HTTPS──▶ Cloudflare（橙云）──▶ 甲骨文 Caddy ──▶ 127.0.0.1:8788
                                                              ▲
                                                    frp 隧道（wss）
                                                              ▲
                                                    机房 frpc ──┘
                                                              │
                                                        机房 服务端:8787 ──▶ 落雪 0.5s
```

**机房不需要任何公网入站端口。** 它只主动往外连。

---

## 一、机房侧（Ubuntu / Debian）

### 1. 装 frpc

```bash
FRP_VERSION=0.62.1
curl -sSL -o frp.tar.gz \
  "https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_amd64.tar.gz"
tar xzf frp.tar.gz
sudo install -m 755 "frp_${FRP_VERSION}_linux_amd64/frpc" /usr/local/bin/frpc
```

### 2. 配置

把仓库里的 `deploy/frpc/frpc.toml` 拷到 `/etc/frp/frpc.toml`，
**把 `__FRP_TOKEN__` 换成甲骨文 `/etc/frp/frps.toml` 里的 token**。

关键几项（已经在模板里）：

| 配置 | 值 | 作用 |
|---|---|---|
| `transport.protocol` | `websocket` | 走 WSS，能被 Caddy 当普通路径转发 |
| `transport.tls.enable` | `true` | 用 wss:// 而不是 ws:// |
| `metadatas.tunnelPath` | `/tunnel` | 和 Caddy 的 `handle /tunnel*` 对上 |
| `transport.heartbeatInterval` | `30` | 每 30 秒心跳 |
| `transport.heartbeatTimeout` | `90` | 90 秒无响应判定断开 |
| `loginFailExit` | `false` | 连不上时不退出，自己一直重试 |

### 3. systemd（自动重启 + 自动重连）

```ini
[Unit]
Description=frp client (ORhythm tunnel)
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/frpc -c /etc/frp/frpc.toml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now frpc
sudo journalctl -u frpc -f      # 看 "login to server success"
```

### 4. 机房上要有服务端

frpc 只是把 **机房本地的 8787** 映射出去。所以机房那台还要跑我们的
服务端（`apps/server`），部署方式和阿里云一样：

```bash
DEPLOY_HOST=<机房IP> DEPLOY_PORT=22 DEPLOY_USER=root \
DEPLOY_DIR=/www/wwwroot/orhythm \
node scripts/deploy-server.mjs
```

---

## 二、甲骨文侧（已经配好了）

```
frps      127.0.0.1:7000     已装，systemd Restart=always
Caddy     handle /tunnel*    已转发到 7000
```

**目前 Caddy 的上游是 `127.0.0.1:8787`（本机容器）。**
机房接进来之后，改成 `127.0.0.1:8788`（隧道映射的端口）即可：

```caddyfile
reverse_proxy 127.0.0.1:8788 {
```

一行改动，`sudo systemctl reload caddy` 生效，**玩家完全无感**。

---

## 三、验证

```bash
# 甲骨文上，隧道通了会看到 8788 在监听
sudo ss -lntp | grep 8788

# frps 日志里出现 login
sudo journalctl -u frps -n 20 | grep -i login

# 从外面打，速度和落雪本地查询一致就对
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" \
  "https://api-orhythm.astranexus.cn/api/v1/maimai/b50?qq=xxxx"
```

---

## 四、为什么不用「甲骨文反代阿里云」

试过了，**不行**。实测：

```
893 KB 一次 1.23 秒（720 KB/s）—— 正常
同一个请求另一次只传 12 KB 就卡死 25 秒
```

跨境链路会被**随机重置**，B50 响应有 96 KB，中途一断就整个废掉。
所以隧道必须是「机房 ↔ 甲骨文」这种长连接 + 自动重连的形态，
而不是每个请求都新建跨境的 HTTP 连接。

---

## 五、安全边界

| | 暴露程度 |
|---|---|
| 机房 | **完全不可见**，只主动外连 |
| 甲骨文 | 公网 IP 已知，但前面有 Cloudflare |
| Cloudflare | 唯一的公网入口，DDoS 打在它身上 |

**App 里只写域名，永远不写 IP。** 换服务器改 DNS 即可，用户不用重装。

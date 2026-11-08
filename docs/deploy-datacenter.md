# 机房部署方案（混合：frp + Cloudflare Tunnel）

> 2026-11-08。机房有公网但**开不了端口**。
>
> **最终选择：哪条路快走哪条。**
>
> - **Casdoor → frp**（阿里云中转）—— 登录页对延迟敏感
> - **API → Cloudflare Tunnel** —— 纯 JSON，Tunnel 够用

---

## 一、为什么分开走

### Casdoor 为什么不能用 Tunnel

登录页是**一整套 HTML + CSS + JS + 字体 + 图片**，首屏要拉十几个资源。

Cloudflare 免费版回源到中国大陆**没有优化线路**，每个资源都多几十到几百毫秒。
十几个资源叠加，登录页会转圈好几秒。

**玩家第一次用 App 就卡在登录页，这个第一印象很致命。**

### API 为什么可以用 Tunnel

API 返回的是**几 KB 的 JSON**，一次请求一次响应，没有子资源。

多几十毫秒用户感知不到 —— 而且 Tunnel 免费、自动 HTTPS、有 DDoS 防护。

### frp 为什么对 Casdoor 更好

阿里云在国内，机房也在国内，**frp 是这两台机器之间直连**，延迟就是一次 RTT。

而且 Casdoor 的流量不大 —— **只有登录时才访问**，不像 API 每次查分都走。
所以占阿里云带宽这件事不严重。

---

## 二、架构

```
│
├─ auth.astramai.astranexus.cn   （Casdoor）
│     │
│     │  DNS → 阿里云 101.132.148.117
│     ▼
│   阿里云
│     nginx（443，Let's Encrypt 证书）
│       ↓ 反代 127.0.0.1:8000
│     frps（bind 127.0.0.1:8000）
│       ↓ frp 隧道（TCP，出站）
│   机房
│     frpc → casdoor:8000
│
└─ api.astramai.astranexus.cn   （AstraMai API）
      │
      │  DNS → Cloudflare（橙色云）
      ▼
    Cloudflare Tunnel
      ↓ cloudflared 出站
    机房
      astramai-server:8787
```

**两条路互不影响。** 任意一条挂了，另一条照常。

---

## 三、frp 那半边的具体做法

### 阿里云侧（frps）

```ini
# /etc/frp/frps.ini
[common]
bind_addr = 127.0.0.1
bind_port = 7000

# 只开这一个 token，别用默认的空
token = <生成一个长的随机串>

# 管理面板（可选，本地开就行）
dashboard_addr = 127.0.0.1
dashboard_port = 7500
```

**⚠️ 三个安全要点：**

1. **`bind_addr = 127.0.0.1`** —— 不要 `0.0.0.0`。
   frps 不需要从公网直接访问，只让 frpc 连。

2. **必须设 `token`** —— 不设的话任何人都能把隧道挂到你服务器上。

3. **防火墙只放 7000** —— 别把 7500 管理面板也放出去。

```bash
# systemd
[Unit]
Description=frps
After=network.target

[Service]
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.ini
Restart=always

[Install]
WantedBy=multi-user.target
```

### 机房侧（frpc）

```ini
# /etc/frp/frpc.ini
[common]
server_addr = 101.132.148.117
server_port = 7000
token = <和 frps 一致>

[casdoor]
type = tcp
local_ip = 127.0.0.1
local_port = 8000
remote_port = 8000
```

**⚠️ `remote_port` 只在阿里云的 `127.0.0.1` 上监听** —— 因为 frps 的
`bind_addr` 是 127.0.0.1，所以这个端口不会暴露给公网，只有 nginx 能连。

### 阿里云侧（nginx）

```nginx
server {
    listen 443 ssl http2;
    server_name auth.astramai.astranexus.cn;

    ssl_certificate     /etc/letsencrypt/live/auth.astramai.astranexus.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/auth.astramai.astranexus.cn/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Casdoor 的登录流程里有重定向，这些头必须传对，
        # 不然 Casdoor 会生成 http:// 的回调地址，然后被浏览器拦
    }
}
```

**⚠️ `X-Forwarded-Proto $scheme` 是关键。**
Casdoor 用它拼回调 URL。漏了的话用户登录完会卡在
「重定向 URI 不匹配」，而且日志里看不出来。

证书用 certbot：

```bash
certbot --nginx -d auth.astramai.astranexus.cn
```

**⚠️ 阿里云那台只有 1676 MB。** nginx + frps 大概 60 MB，够。
但**不要再往它上面加东西**。

---

## 四、Tunnel 那半边的具体做法

```bash
cloudflared tunnel login
cloudflared tunnel create astramai-api
cloudflared tunnel route dns astramai-api api.astramai.astranexus.cn
```

```yaml
# ~/.cloudflared/config.yml
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: api.astramai.astranexus.cn
    service: http://localhost:8787
  - service: http_status:404
```

```bash
cloudflared service install
```

**⚠️ Cloudflare 免费版单请求 100 秒上限。**
服务端自己要 15 秒超时 —— 现在的实现已经有，别改大。

---

## 五、机房侧完整的 docker-compose

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: <改掉>
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    restart: unless-stopped

  casdoor:
    image: casbin/casdoor:latest
    ports: ['8000:8000']
    environment:
      driverName: postgres
      dataSourceName: "user=casdoor password=<改掉> host=postgres port=5432 dbname=casdoor sslmode=disable"
    depends_on: [postgres]
    restart: unless-stopped

  astramai-server:
    build: .
    ports: ['8787:8787']
    env_file: .env
    restart: unless-stopped

  frpc:
    image: snowdreamtech/frpc:latest
    volumes:
      - ./frpc.ini:/etc/frp/frpc.ini:ro
    restart: unless-stopped

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run
    volumes:
      - ./cloudflared:/root/.cloudflared:ro
    restart: unless-stopped
```

**新增：frpc 和 cloudflared 都放进来** —— 两个都是出站，互不干扰。

---

## 六、还剩的问题

### ① 证书续期

阿里云上的 Let's Encrypt 证书 90 天过期。certbot 的 systemd timer 会自动续，
但要**确认它真的跑起来了**：

```bash
systemctl status certbot.timer
certbot renew --dry-run
```

**忘了这件事的话，90 天后登录页会直接证书错误。**

### ② 阿里云带宽

frp 走 TCP，登录页的资源都过它。**如果带宽只有 1-2 Mbps**，
登录页首屏可能要好几秒。

**上线前要实测**：用手机 4G 打开 `https://auth.astramai.astranexus.cn`，
看多久能出登录框。

**如果太慢**，退路是：
- 让 Casdoor 用更小的主题（它默认那个背景图挺大）
- 或者升级阿里云带宽

### ③ 还是那个没答的问题

**「TwinkleAstra 账号体系」是已有 Casdoor 实例，还是从零建？**

这个不定，上面所有配置都不能落地 —— 因为：
- 已有实例 → 我们只建一个「应用」，不建组织和库
- 从零建 → 要建组织、要配 SMTP（找回密码要用）、要考虑用户迁移

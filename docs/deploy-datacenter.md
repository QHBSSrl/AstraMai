# 机房部署方案（frp vs Cloudflare Tunnel）

> 2026-11-08。机房有公网但**开不了端口**，所以只能内网穿透。
>
> **结论：用 Cloudflare Tunnel，不用 frp。**

---

## 一、为什么不用 frp

frp 能用，但它需要一个**一直开着的公网服务器**当 frps。
我们手上只有那台阿里云（2 核 / 1676 MB）。

这带来三个问题：

| 问题 | 说明 |
|---|---|
| **带宽是瓶颈** | 阿里云那台的出网带宽很有限。所有 API 响应、所有封面图都要过它一遍 |
| **单点故障** | 那台挂了，机房里再多的机器也没用 |
| **还要自己搞证书** | certbot 要配，续期要管，忘了就全站 502 |

**frp 的本质是「把公网服务器当跳板」。** 我们明明有 Cloudflare，不需要这个跳板。

---

## 二、Cloudflare Tunnel 是什么

`cloudflared` 在机房里跑，**主动向 Cloudflare 建立出站连接**（和 frpc 一样），
Cloudflare 边缘把请求转发进来。

```
用户 → Cloudflare 边缘（全球 300+ 节点）→ 隧道 → 机房
```

**对比 frp：**

| | frp + 阿里云 | Cloudflare Tunnel |
|---|---|---|
| 需要公网服务器 | ✅ 必须 | ❌ 不需要 |
| 需要开端口 | ❌ 出站就行 | ❌ 出站就行 |
| HTTPS 证书 | 自己签、自己续 | **自动** |
| 带宽 | 阿里云的 | **Cloudflare 的** |
| 抗攻击 | 无 | **有 DDoS 防护** |
| 成本 | 阿里云月费 | **免费** |
| 延迟 | 机房 → 阿里云 → 用户 | 机房 → 最近边缘 → 用户 |

**而且我们已经在用 Cloudflare 了** —— Worker 和 Pages 都在上面，域名也托管着。
再加一个 Tunnel 是零成本的。

---

## 三、建议的最终架构

```
│
├─ Flutter App（三端）
│     │
│     ├─ auth.astramai.astranexus.cn   ← Casdoor（OIDC）
│     └─ api.astramai.astranexus.cn    ← AstraMai server
│
└─ 全部指向 Cloudflare Tunnel
        │
        ▼
┌──────────────────────────────────────────┐
│ 机房（R730XD 或一台 IR5280M6）             │
│                                          │
│   cloudflared                            │
│     ├─ → casdoor:8000                    │
│     └─ → astramai-server:8787            │
│                                          │
│   casdoor        ← 账号 + OIDC            │
│   postgres       ← Casdoor 的库           │
│   astramai-server                        │
│   redis          ← 缓存（可选）            │
│                                          │
│   全部 Docker Compose                      │
└──────────────────────────────────────────┘
```

**阿里云那台可以退休了** —— 或者只留一个备用入口。

---

## 四、部署步骤（粗略）

### 1. Cloudflare 侧

```bash
# 在机房机器上装 cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# 登录（会打开浏览器授权）
cloudflared tunnel login

# 建隧道
cloudflared tunnel create astramai
```

然后在 Cloudflare 控制台或配置里加路由：

```yaml
# ~/.cloudflared/config.yml
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: auth.astramai.astranexus.cn
    service: http://localhost:8000
  - hostname: api.astramai.astranexus.cn
    service: http://localhost:8787
  - service: http_status:404
```

```bash
# DNS 也自动建（CNAME 到 tunnel）
cloudflared tunnel route dns astramai auth.astramai.astranexus.cn
cloudflared tunnel route dns astramai api.astramai.astranexus.cn

# 装成系统服务
cloudflared service install
```

### 2. 机房侧

```yaml
# docker-compose.yml
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
    image: <我们的镜像>
    ports: ['8787:8787']
    env_file: .env
    restart: unless-stopped
```

**这次可以在机器上直接 `docker compose build`** —— 不用再来回传。

### 3. Casdoor 初始化

第一次访问 `https://auth.astramai.astranexus.cn` 会引导建管理员，然后：

- 建组织：`astramai`
- 建应用：`astramai-app`（OIDC）
- 重定向 URI：`astramai://callback`
- 拿到 `client_id` / `client_secret`

---

## 五、必须提前想到的三个坑

### ① Cloudflare 的 100 秒超时

**Cloudflare 免费版对单个请求有 100 秒上限。**

我们的接口一般 1-3 秒，没问题。但**如果某个查询超过 100 秒会直接断**，
而不是返回我们的超时错误。

**要确保服务端自己先超时**（现在是 15 秒），别让它跑到 100 秒。

### ② 上传大小限制

**免费版单请求 100 MB。** 我们目前没有上传，不受影响。
但以后要做成绩图分享，要注意。

### ③ WebSocket / SSE

如果要加实时推送，**Cloudflare 支持 WebSocket**，但不支持 `/events` 这类长轮询流。
现在的架构不需要，记着就行。

---

## 六、迁移顺序（保守）

| 阶段 | 做什么 | 风险 |
|---|---|---|
| **1** | 机房起 Postgres + Casdoor，Tunnel 只暴露 auth | 低 —— 挂了不影响查分 |
| **2** | App 接入登录，验证 OIDC 流程 | 中 —— 要改 App |
| **3** | 服务端加 JWT 校验 | 中 |
| **4** | 把 AstraMai server 也搬过去，Tunnel 加 api | 高 —— 查分是核心功能 |
| **5** | 阿里云降级或退掉 | 低 |

**⚠️ 第 4 步是唯一有真实风险的** —— 查分挂了用户立刻会骂。
建议先**双跑**：两个地址都能查，观察一周再切。

---

## 七、还要你确认的

1. **`astranexus.cn` 的 DNS 是不是完全在 Cloudflare？**（Worker 用了它，应该是在）
2. **机房那台机器装 Linux 了吗？** 什么发行版？
3. **「TwinkleAstra 账号体系」** —— 已有 Casdoor 实例，还是从零建？

第 3 条还是最关键的 —— 决定我们是「配一个 OIDC 应用」还是「建整套」。

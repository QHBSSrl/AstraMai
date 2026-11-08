# 落地部署方案（PVE + Casdoor 从零 + frp/Tunnel 混合）

> 2026-11-08 定稿。硬件和选择都确定了，这份可以直接照着做。

---

## 一、硬件现状

| 机器 | 类型 | 用途 |
|---|---|---|
| **Dell R730XD** | PVE 物理机，2699v4×2 = 44核88线程，256 GB | **主服务器** |
| 浪潮 IR5280M6 × 5 | 浪潮虚拟化集群 | **备份 / CI / 以后扩展** |

**⚠️ R730XD 上跑的是 PVE，所以我们的服务也是虚拟机。**

---

## 二、第一个决定：VM 还是 LXC

**用 VM（QEMU），不用 LXC。**

| | LXC | VM |
|---|---|---|
| 开销 | 极低 | 多 200-400 MB |
| **Docker** | ⚠️ **有坑** | ✅ 原生 |
| 内核 | 共享宿主的 | 独立 |

**LXC 里跑 Docker 的坑：**

- cgroup v2 默认不给你，`--cgroupns=host` 才勉强能跑
- overlayfs 在某些内核版本上直接不工作
- `docker compose` 的 network 有时创建失败

**我们只有 5 个容器，多 300 MB 内存完全不是问题。别省这个。**

---

## 三、VM 配置

在 PVE 上建一台：

```
名称    astramai-prod
系统    Debian 12 (bookworm) 最小安装
CPU     4 核（host 类型，别用 kvm64，性能差一截）
内存    8 GB（够编译 Flutter 了，不需要 16）
磁盘0   32 GB  (系统)
磁盘1   50 GB  (数据，单独一块)
网络    vmbr0，静态 IP
```

**为什么单独一块数据盘：**

- 系统盘可以随便重装，数据盘挂回去就行
- 备份策略可以分开（数据盘每天，系统盘每周）
- ZFS 上可以单独开 compression

**⚠️ CPU 类型一定要选 `host`。** PVE 默认是 `kvm64`，
会把 2699v4 的 AVX2 等指令集屏蔽掉，性能损失不小。

---

## 四、Debian 12 初始化

```bash
# 基本东西
apt update && apt install -y curl gnupg ca-certificates \
    git make unzip vim htop nginx certbot python3-certbot-nginx

# Docker（官方源，别用 Debian 自带的那个老版本）
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/debian bookworm stable" \
    > /etc/apt/sources.list.d/docker.list
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 时区
timedatectl set-timezone Asia/Shanghai
```

### 数据盘挂载

```bash
# 假设数据盘是 /dev/sdb
mkfs.ext4 /dev/sdb
mkdir -p /data
echo '/dev/sdb /data ext4 defaults,noatime 0 2' >> /etc/fstab
mount -a
```

**⚠️ 用 `/dev/sdb` 这种设备名很脆弱** —— 加一块盘顺序变了就挂错。
正式环境应该用 `UUID=`：

```bash
blkid /dev/sdb
# 复制输出的 UUID，写进 fstab：
# UUID=xxxx-xxxx /data ext4 defaults,noatime 0 2
```

---

## 五、目录结构

```
/data/astramai/
  docker-compose.yml
  .env                    ← 密钥，不进 git
  data/
    postgres/             ← Casdoor 的库
  frpc/
    frpc.ini
  cloudflared/
    config.yml
    credentials.json
```

**⚠️ `chmod 700 /data/astramai`，`chmod 600 .env`。**
里面有数据库密码和各种 token。

---

## 六、docker-compose.yml

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: casdoor
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: casdoor
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U casdoor']
      interval: 10s
      timeout: 5s
      retries: 5

  casdoor:
    image: casbin/casdoor:latest
    ports:
      - '127.0.0.1:8000:8000'
    environment:
      driverName: postgres
      dataSourceName: "user=casdoor password=${POSTGRES_PASSWORD} host=postgres port=5432 dbname=casdoor sslmode=disable"
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  astramai-server:
    build: ./server
    ports:
      - '127.0.0.1:8787:8787'
    env_file: .env
    restart: unless-stopped

  frpc:
    image: snowdreamtech/frpc:latest
    volumes:
      - ./frpc/frpc.ini:/etc/frp/frpc.ini:ro
    restart: unless-stopped

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run
    volumes:
      - ./cloudflared:/root/.cloudflared:ro
    restart: unless-stopped
```

**关键点：**

- **所有端口都绑 `127.0.0.1`** —— 只有本机的 frpc / cloudflared 能连，
  公网进不来
- `depends_on` 用了 `condition: service_healthy` —— 不然 Casdoor 会在
  Postgres 还没起来时启动，然后崩溃重启好几次

### .env

```bash
POSTGRES_PASSWORD=<生成一个长的>
LXMNS_TOKEN=<落雪的>
DIVINGFISH_KEY=<水鱼的>
...
```

```bash
# 生成密码
openssl rand -base64 32
```

---

## 七、Casdoor 从零初始化

### 1. 先临时暴露

第一次要进管理后台建组织，得先能访问。

```bash
# 临时改端口绑定，用 SSH 隧道访问（更安全）
ssh -L 8000:127.0.0.1:8000 root@<VM的IP>
# 然后在本地浏览器开 http://localhost:8000
```

**⚠️ 不要为了初始化就把它绑 `0.0.0.0` 挂到公网。**
管理后台裸奔几分钟就可能被扫到。

### 2. 建管理员

第一次访问会引导：

```
组织     astramai
用户名   admin
密码     <长密码，存好>
邮箱     <你的>
```

### 3. 建组织

```
名称      astramai
显示名    AstraMai
```

### 4. 建应用

```
名称          astramai-app
显示名        AstraMai
组织          astramai

客户端认证方式  Authorization Code
Token 格式     JWT
过期时间       7 天（手机端，别太短）

重定向 URL    astramai://callback
```

**⚠️ 重定向 URL 必须精确匹配。**

`astramai://callback` 和 `astramai://callback/` 是两个不同的值，
Casdoor 会拒绝不匹配的那个，而且只报「invalid redirect uri」，
不说差在哪。

### 5. 拿凭据

建完在应用详情页能看到：

```
Client ID
Client Secret
证书（公钥，验签用）
```

**Client Secret 只显示一次**，存到 `.env` 里。

### 6. 配 SMTP

Casdoor 的「找回密码」「邮箱验证」都要它。

```
SMTP Host     smtp.qq.com（或你们自己的）
Port          465
用户名        <邮箱>
密码          <授权码，不是邮箱密码>
发件人        <邮箱>
```

**⚠️ QQ 邮箱的「密码」是授权码，要去设置里单独生成。**
填登录密码会一直认证失败。

### 7. 自动 Plus 订阅

「登录后自动订阅，免费」有几种做法，**建议用 Casdoor 的「组织默认角色」**：

```
组织 astramai
  └─ 角色 plus
       └─ 所有新用户自动加入
```

Casdoor 的角色可以设成「默认角色」，新注册用户自动获得。

然后服务端校验 JWT 时检查 `roles` 里有没有 `plus`。

**⚠️ 以后要收费的话**，把「默认角色」取消就行，不用改代码。

---

## 八、frp（Casdoor 走这条）

### 阿里云侧 frps

```ini
# /etc/frp/frps.ini
[common]
bind_addr = 127.0.0.1
bind_port = 7000
token = <openssl rand -base64 32>

dashboard_addr = 127.0.0.1
dashboard_port = 7500
```

```bash
# 防火墙只放 7000
ufw allow 7000/tcp
```

### 机房侧 frpc

```ini
# /data/astramai/frpc/frpc.ini
[common]
server_addr = 101.132.148.117
server_port = 7000
token = <和 frps 一致>
login_fail_exit = false

[casdoor]
type = tcp
local_ip = 127.0.0.1
local_port = 8000
remote_port = 8000
```

**⚠️ `login_fail_exit = false`** —— 阿里云重启时 frpc 不会退出，
会一直重试。默认 `true` 的话它退出后 Docker 才重启，中间有几秒空窗。

### 阿里云侧 nginx

```nginx
server {
    listen 443 ssl http2;
    server_name auth.astramai.astranexus.cn;

    ssl_certificate     /etc/letsencrypt/live/auth.astramai.astranexus.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/auth.astramai.astranexus.cn/privkey.pem;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

**三个关键头：**

| 头 | 漏了会怎样 |
|---|---|
| `Host $host` | Casdoor 拼出错误的回调地址 |
| `X-Forwarded-Proto $scheme` | 生成 `http://` 回调，被浏览器拦 |
| `Upgrade` / `Connection` | Casdoor 的某些实时功能失效 |

**这几个错了都只报「重定向 URI 不匹配」，日志里看不出原因。**

---

## 九、Cloudflare Tunnel（API 走这条）

```bash
cloudflared tunnel login
cloudflared tunnel create astramai-api
cloudflared tunnel route dns astramai-api api.astramai.astranexus.cn
```

```yaml
# /data/astramai/cloudflared/config.yml
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: api.astramai.astranexus.cn
    service: http://localhost:8787
  - service: http_status:404
```

**⚠️ Cloudflare 免费版单请求 100 秒上限。**
服务端自己超时 15 秒，别改大。

---

## 十、备份（这条最容易被忘）

**PVE 的快照不是备份。** 快照和虚拟机在同一个存储上，
存储坏了两个一起没。

### 三层备份

| 层 | 频率 | 到哪 |
|---|---|---|
| **PVE 虚拟机备份** | 每周 | 浪潮集群的存储（NFS/SMB） |
| **Postgres dump** | 每天 | 同上，保留 30 天 |
| **配置文件** | 改动时 | git（`.env` 除外） |

### Postgres 每日 dump

```bash
# /data/astramai/backup.sh
#!/bin/bash
set -e
DATE=$(date +%Y%m%d)
docker compose -f /data/astramai/docker-compose.yml exec -T postgres \
    pg_dump -U casdoor casdoor | gzip > /backup/casdoor-$DATE.sql.gz
find /backup -name 'casdoor-*.sql.gz' -mtime +30 -delete
```

```bash
chmod +x /data/astramai/backup.sh
# crontab
0 3 * * * /data/astramai/backup.sh
```

**⚠️ Casdoor 的用户表丢了 = 所有人要重新注册。**
这个备份不是可选项。

### 挂到浪潮集群

```bash
# 在 PVE 的 VM 里
apt install -y nfs-common
mkdir -p /backup
echo '10.x.x.x:/volume1/astramai-backup /backup nfs defaults 0 0' >> /etc/fstab
mount -a
```

---

## 十一、执行顺序

| # | 做什么 | 预计 |
|---|---|---|
| 1 | PVE 建 VM，装 Debian 12，挂数据盘 | 1 小时 |
| 2 | 装 Docker，建目录，写 compose | 30 分钟 |
| 3 | 起 Postgres + Casdoor，SSH 隧道进去初始化 | 1 小时 |
| 4 | 建组织 / 应用 / 角色 / SMTP，拿凭据 | 1 小时 |
| 5 | 阿里云配 frps + nginx + 证书 | 1 小时 |
| 6 | 机房配 frpc，验证 `https://auth...` 能打开 | 30 分钟 |
| 7 | 配 Cloudflare Tunnel，验证 `https://api...` | 30 分钟 |
| 8 | 配备份 + 测恢复 | 1 小时 |

**总共一天。** 第 8 步别跳过 —— 备份没测过等于没有。

---

## 十二、上线前的检查清单

- [ ] `https://auth.astramai.astranexus.cn` 手机 4G 能打开，且**不超过 3 秒**
- [ ] 证书有效期 > 60 天（`certbot certificates`）
- [ ] `certbot renew --dry-run` 通过
- [ ] `https://api.astramai.astranexus.cn/api/health` 返回 200
- [ ] Casdoor 能完成一次完整的登录 → 拿到 token
- [ ] Postgres dump 能恢复到一个空库
- [ ] PVE 的备份任务真的跑过一次（看日志，不是看配置）
- [ ] `.env` 权限 600，`/data/astramai` 权限 700
- [ ] frps 的 `bind_addr` 是 127.0.0.1（不是 0.0.0.0）
- [ ] frps 设了 token
- [ ] 阿里云防火墙只开了 7000 和 443

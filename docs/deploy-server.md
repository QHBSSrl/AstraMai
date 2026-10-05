# 部署 AstraMai 服务端

服务端存在的意义：**落雪开发者密钥只留在服务器上**，客户端（手表、网页）拿到的
只是聚合后的结果。所以它一旦对外可达，就等同于半个密钥保管箱，部署时请按这个前提来做。

---

## 一、部署前必须知道的两件事

1. **绑公网就必须设 `API_TOKEN`。**
   不设的话进程会**直接拒绝启动**（`apps/server/src/config.ts` 的 `assertDeploymentSafety`）。
   这是刻意的：宁可起不来，也不要静默把密钥敞开。
2. **容器内必须 `HOST=0.0.0.0`。**
   默认值是 `127.0.0.1`，容器里绑回环会导致端口映射进不来。

---

## 二、方式 A：Docker Compose（推荐）

```bash
git clone <你的仓库地址> astramai && cd astramai

cp .env.server.example .env.server
# 生成一个令牌填进 API_TOKEN
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
vim .env.server          # 填 LXNS_API_KEY 和 API_TOKEN

docker compose up -d --build
docker compose logs -f
```

`docker-compose.yml` 默认把端口绑在 `127.0.0.1:8787`，交给反向代理终结 TLS。
想让容器直接对外，把 `ports` 改成 `"8787:8787"`。

---

## 三、方式 B：直接跑 Node + systemd

```bash
# 需要 Node 20.10+
git clone <你的仓库地址> /opt/astramai && cd /opt/astramai
npm ci
npm run build

cp .env.server.example .env.server
vim .env.server
```

`/etc/systemd/system/astramai.service`：

```ini
[Unit]
Description=AstraMai server
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/astramai
EnvironmentFile=/opt/astramai/.env.server
ExecStart=/usr/bin/node apps/server/dist/index.js
Restart=always
RestartSec=3
# 密钥只在 root 可读
UMask=0077
User=astramai

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /usr/sbin/nologin astramai
sudo chown -R astramai:astramai /opt/astramai
sudo chmod 600 /opt/astramai/.env.server
sudo systemctl enable --now astramai
sudo systemctl status astramai
```

---

## 四、反向代理

**Caddy**（自动申请证书，最省事）：

```
mai.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

**Nginx**：

```nginx
server {
    listen 443 ssl http2;
    server_name mai.example.com;

    ssl_certificate     /etc/letsencrypt/live/mai.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mai.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        # 服务端的限流按来源 IP 计数，必须透传真实 IP，否则所有人共用一个配额
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> ⚠️ `X-Forwarded-For` 不是可选项。服务端的按 IP 限流取的是这个头的第一段
> （见 `apps/server/src/guard.ts`），不透传的话所有请求会被算作同一个来源。

---

## 五、验证

```bash
# 1. 健康检查（免令牌，不用带任何头）
curl -s https://mai.example.com/api/health

# 期望看到 hasServerKey: true、mode: "live"、tokenRequired: true

# 2. 不带令牌访问受保护接口 → 401
curl -s -o /dev/null -w '%{http_code}\n' https://mai.example.com/api/maimai/songs

# 3. 带令牌 → 200
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "x-api-key: $API_TOKEN" https://mai.example.com/api/maimai/songs
```

`/api/health` 的 `accessControl.tokenRequired` 应当是 `true`；
如果是 `false`，说明 `API_TOKEN` 没生效，**立刻停下检查**。

---

## 六、把客户端指过来

### 手表（Vela）

手表上的服务端地址通过本地存储的 `serverBase` 键读取
（`apps/vela/src/common/config.js`），默认值是模拟器用的 `http://10.0.2.2:8787`。

**真机必须改成你的公网地址**，且必须是手表能访问到的地址：

- `https://mai.example.com` —— 推荐，有 TLS
- `http://<公网IP>:8787` —— 可行但明文，令牌会裸奔

> 模拟器里的 `10.0.2.2` 是 QEMU 用户态网络里**宿主机**的地址
> （模拟器 `wlan0` 是 `10.0.2.15`、网关 `10.0.2.2`，实测确认）。
> 模拟器填局域网 IP 或 `localhost` 都连不上。

### 网页测试站

服务端会自动挂载 `apps/web/dist`（构建过的话）。
浏览器打开站点后，在设置里填**服务端地址**和 **API_TOKEN** 两项。

---

## 七、上线前检查清单

- [ ] `API_TOKEN` 已设置，且是随机生成的长串（不是 `test`、`123456` 这类）
- [ ] `ALLOW_CLIENT_KEY=false`
- [ ] `LXNS_API_KEY` 只存在于服务器，**没有进过 git**
- [ ] 反向代理透传了 `X-Forwarded-For`
- [ ] 已用上面的三条 `curl` 验证过 401/200
- [ ] `.env.server` 权限 600，属主是运行服务的用户
- [ ] 已确认公网地址可以从**手表所在网络**访问到（不是只在你电脑上能通）

---

## 八、常见问题

**进程起来就退出，日志里说「拒绝启动：...没有设置 API_TOKEN」**
这是安全校验。按日志提示设好 `API_TOKEN` 再启动。

**`/api/health` 里 `mode` 是 `mock`**
说明没有拿到开发者密钥。检查 `LXNS_API_KEY` 是否填了、`LXNS_MODE` 是否为 `live`。
设成 `LXNS_MODE=live` 而缺密钥时会直接启动失败，这样就不会静默返回假数据。

**手表连不上，但电脑上 curl 正常**
多半是地址填错了。注意手表上和电脑上「能访问的地址」不一定相同：
电脑上 `127.0.0.1` 是服务器本身，手表上那是手表自己。

# 用宝塔面板部署 AstraMai 服务端

## ✅ 当前状态：已经部署好了

**不用再按下面的步骤做一遍。** 截至最近一次部署：

| 项目 | 值 |
| --- | --- |
| 地址 | `http://101.132.148.117:8787` |
| 运行方式 | Docker 容器 `astramai`，`--restart unless-stopped`（服务器重启会自动拉起） |
| 代码目录 | `/www/wwwroot/astramai` |
| **鉴权** | **`AUTH_MODE=open` —— 不校验令牌，客户端不用配任何东西** |
| 容器内存占用 | 约 **33–38 MB** |
| 健康检查 | `curl http://101.132.148.117:8787/api/health` |

### 鉴权：当前是公开模式，客户端不用配任何令牌

服务端现在跑在 **`AUTH_MODE=open`**：**不校验访问令牌**，
所以网页、手表、第三方客户端直接用就行，不需要和服务端「配同一个令牌」。

为什么这么做：这个 App 是要公开分发给大家用的，
而**令牌写进客户端包里就不再是秘密**（谁拿到 App 都能解出来），
把它当门禁只是自欺欺人。

公开模式下真正的约束是两道限流，都已经开着：

| 配置 | 当前值 | 作用 |
| --- | --- | --- |
| `RATE_LIMIT_PER_MINUTE` | 120 | 按来源 IP，防止单个客户端狂刷 |
| `UPSTREAM_LIMIT_PER_MINUTE` | 150 | **全局**，每分钟最多打上游这么多次 |

实测：连打 135 次 `/api/v1/sources` → 放行 117 次、返回 429 十八次。

> ⚠️ 唯一的风险是**开发者密钥配额被大量用户消耗**。等上游配额谈妥之前，
> 如果发现 429 变多（`/api/health` 里看 `upstreamBudget.lxns.usedThisMinute`），
> 说明该去找落雪申请放宽了。

`.env` 里仍然保留着 `API_TOKEN`，但 open 模式下它不生效。
将来如果要收回成私有部署，把 `AUTH_MODE` 改回 `key` 重启即可，
届时所有客户端都要配上那个令牌。

### 怎么看当前状态

```bash
curl -s http://101.132.148.117:8787/api/health
```

`accessControl.authMode` 应当是 `open`、`tokenRequired` 是 `false`。

### 怎么更新

改完代码后在**本地仓库**执行一条命令即可：

```bash
node scripts/deploy-server.mjs          # 部署/更新
node scripts/deploy-server.mjs --check  # 只看远端状态，不动任何东西
```

**它不会覆盖服务器上已有的 `.env`**，所以 `API_TOKEN` 不会每次都被换掉、
把已经配好的客户端搞失效。

> ⚠️ 为什么不是「服务器上 `npm ci && npm run build`」：
> 这台机器只有 1676 MB 内存，上面还跑着 MySQL、宝塔、雷池 WAF、QQ 机器人、frps，
> 空闲通常只有 100–180 MB。在上面做一次前端构建很容易 OOM。
> 所以部署脚本改为**本地构建、只上传运行产物**（约 375 KB），
> 服务器上只做一次纯 COPY 的 `docker build`。

### 分享给别人用

别人没有落雪开发者密钥，所以让他们直接用我们这台服务器是对的。
做法就是**把上面那个 `API_TOKEN` 给出去**（写进 App 配置、或让网页版用户填进设置里）。

有两点要清楚：

**1. 令牌一旦分发出去就不是秘密了。** 它写进手表 App 的包里，谁拿到 App 都能解出来。
所以这道闸挡的是**随机扫描器和路过的路人**，挡不住拿到 App 的人——
而这恰好就是「开放给别人用、但不想公开」所需要的效果。

**2. 真正保护你密钥配额的是全局上游预算。** 见下面的说明。
因为令牌拦不住拿到 App 的人，所以不能靠它限制用量；万一有人写脚本刷，
烧的是**你自己的**开发者密钥配额，[落雪会返回 429](https://maimai.lxns.net/docs/developer-guide)。

#### 给不同的人发不同的令牌（便于单独吊销）

`API_TOKENS` 支持逗号分隔的多个令牌：

```ini
API_TOKENS=friends-8f3a...,group-2b91...
```

这样某一个人的令牌泄露了，**只把他的去掉重启即可**，不用让所有人的一起失效；
用户侧只需要改自己那一份配置。

改完重启：

```bash
docker rm -f astramai
docker run -d --name astramai --restart unless-stopped \
  --env-file /www/wwwroot/astramai/.env \
  -e HOST=0.0.0.0 -e PORT=8787 -p 8787:8787 astramai-server:latest
```

#### 全局上游预算

```ini
UPSTREAM_LIMIT_PER_MINUTE=150
```

意思是**整个服务器每分钟最多向落雪发 150 次请求，跟有多少客户端无关**。

- 只统计真正打到落雪的请求，命中曲库缓存的不算
- 一次 B50 查询 = 2 次上游调用（取玩家 + 取 Best 50），所以 150 ≈ 每分钟 75 次查询
- 小圈子正常用**根本碰不到**，只在被脚本刷的时候才会生效
- 触发时返回 429 和一句明确的提示，而不是让落雪来拒绝你
- 设为 `0` 关闭

当前余量可以从健康检查里看到：

```bash
curl -s http://127.0.0.1:8787/api/health | grep -o '"upstreamBudget":{[^}]*}'
# {"limitPerMinute":150,"usedThisMinute":0,"remaining":150}
```

### 常用排查命令

```bash
docker ps --filter name=astramai          # 在不在跑
docker logs --tail 50 astramai            # 看日志
docker stats --no-stream astramai         # 看内存占用
curl -s http://127.0.0.1:8787/api/health  # 本机健康检查
```

---

## 下面是完整的从零部署步骤

> 只有在换服务器、或者要从头重来的时候才需要看。
> 正常更新用上面那条 `node scripts/deploy-server.mjs` 就够。

面向「不想敲太多命令」的场景。全程只需要复制粘贴两次命令，其余都是点鼠标。

**你的地址**：`http://101.132.148.117:8787`

> 域名没备案 → 绑不了域名 → 暂时没有 HTTPS。
> 也就是说 `API_TOKEN` 在网络上是**明文**传输的。
> 所以第五节那个令牌一定要用随机长串，不要图省事写 `123456`。

---

## 零、先明确一件事

服务端会**自己读取项目根目录的 `.env` 文件**，所以密钥不用在面板里配环境变量，
建一个文件就行——这也是下面第三节的全部内容。

---

## 一、装 Node 20

1. 宝塔面板 → 左侧 **软件商店**
2. 搜索 **Node.js版本管理器** → 安装（如果已经装了，跳过）
3. 装完后打开它 → **版本管理** → 安装 **v20**（选最新的 20.x）
4. 装完点一下 **命令行版本** 或 **设为默认**，让终端里的 `node -v` 是 20

验证：宝塔左侧 **终端**，执行

```bash
node -v
```

看到 `v20.x.x` 就行。如果还是旧版本，回到 Node 版本管理器把 20 设为默认。

---

## 二、把代码传上去

1. 宝塔左侧 **文件** → 进入 `/www/wwwroot`
2. **新建目录**，名字填 `astramai`
3. 进入 `astramai`，点 **上传**，把 `astramai-server.zip` 传进去
4. 传完右键这个压缩包 → **解压** → 解压到当前目录
5. 解压后**检查一下层级**：`/www/wwwroot/astramai/package.json` 必须直接存在

> 如果变成了 `/www/wwwroot/astramai/astramai-server/package.json`（多套了一层），
> 就进到里面，全选所有文件 → 剪切 → 回到 `astramai` → 粘贴。

**为什么用这个压缩包**：它由 `git archive` 生成，只含已提交的文件，
所以里面**没有** `.env`，也就不可能把你的密钥打包进去。

---

## 三、写配置文件

在 `/www/wwwroot/astramai` 下新建文件 `.env`（注意开头有个点），内容：

```ini
# 落雪开发者密钥，只在服务器上，不会下发给手表或浏览器
LXNS_API_KEY=你的密钥

# 访问令牌，必须改成随机长串
API_TOKEN=这里粘贴随机串

# 对外提供服务必须绑 0.0.0.0
HOST=0.0.0.0
PORT=8787

# 生产环境不要让客户端递交自己的密钥
ALLOW_CLIENT_KEY=false

LXNS_MODE=auto
```

**先生成令牌**，在宝塔终端执行：

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

把输出的那串复制到 `API_TOKEN=` 后面。

**再把 `.env` 权限收紧**（终端执行）：

```bash
chmod 600 /www/wwwroot/astramai/.env
```

> ⚠️ `API_TOKEN` 不要留空。留空的话服务端**会拒绝启动**，
> 这是故意的——它手里有开发者密钥，没令牌就对外暴露等于把密钥送人。

---

## 四、构建（第一条命令）

宝塔左侧 **终端**，复制粘贴：

```bash
cd /www/wwwroot/astramai && npm ci && npm run build
```

等它跑完（一两分钟）。看到没有红色报错就行。

---

## 五、启动

### 方式一：宝塔面板点鼠标

1. 左侧 **网站** → 顶部 **Node项目** → **添加Node项目**
2. 按下表填：

   | 字段 | 填什么 |
   | --- | --- |
   | 项目名称 | `astramai` |
   | 项目目录 | `/www/wwwroot/astramai` |
   | Node版本 | `v20.x` |
   | 启动选项 | 选 **自定义启动命令**，填 `node apps/server/dist/index.js` |
   | 端口 | `8787` |
   | 运行用户 | `www` |

3. 确定。状态显示 **运行中** 就成了

> 面板版本不同，字段名可能略有差异。如果找不到「自定义启动命令」，
> 或者点了没反应，直接用下面的方式二，更稳。

### 方式二：终端 PM2（面板对不上时用这个）

```bash
cd /www/wwwroot/astramai
npm i -g pm2
pm2 start apps/server/dist/index.js --name astramai
pm2 save
pm2 startup
```

`pm2 startup` 会打印一条 `sudo env PATH=...` 开头的命令，**把它复制出来再执行一遍**，
这样服务器重启后服务会自动起来。

常用命令：

```bash
pm2 status              # 看状态
pm2 logs astramai       # 看日志
pm2 restart astramai    # 重启
```

---

## 六、放行 8787 端口 ⚠️ 最容易漏的一步

**两个地方都要放行，只做一处是连不上的。**

### 1. 宝塔自己的防火墙

左侧 **安全** → **添加端口规则**：

- 端口：`8787`
- 协议：`TCP`
- 备注：`AstraMai`
- 放行

### 2. 阿里云安全组（你这台是阿里云）

1. 登录 [阿里云控制台](https://ecs.console.aliyun.com/)
2. **云服务器 ECS** → **实例** → 找到这台机器 → 点实例 ID 进详情
3. 左侧 **安全组** → 点安全组 ID → **入方向** → **手动添加**
4. 填：

   | 字段 | 值 |
   | --- | --- |
   | 授权策略 | 允许 |
   | 协议类型 | 自定义 TCP |
   | 端口范围 | `8787/8787` |
   | 授权对象 | `0.0.0.0/0` |
   | 描述 | AstraMai |

5. 保存

> 忘配安全组是最常见的原因——宝塔里放行了，外面还是连不上，就是这里。

---

## 七、验证

### 在服务器本机

```bash
curl -s http://127.0.0.1:8787/api/health
```

### 在你电脑的浏览器

打开：

```
http://101.132.148.117:8787/api/health
```

**期望看到**（关键三个字段）：

```json
{
  "ok": true,
  "data": {
    "hasServerKey": true,          // ← 密钥读到了
    "mode": "live",                // ← 走真实接口，不是模拟数据
    "accessControl": { "tokenRequired": true }   // ← 令牌生效了
  }
}
```

这三个都对，就可以填进手表了。

**如果 `tokenRequired` 是 `false`**：说明 `API_TOKEN` 没读到。
**立刻把安全组的 8787 规则删掉**，检查 `.env` 是否在 `/www/wwwroot/astramai/` 下、
是否叫 `.env`（不是 `.env.txt`），然后重启服务。

---

## 八、还自带一个网页版

服务端会顺便把网页测试站挂在同一个地址上，浏览器打开：

```
http://101.132.148.117:8787/
```

在页面设置里填 **服务端地址** 和 **API_TOKEN** 两项即可。

---

## 九、常见问题

**面板里显示「运行中」，但浏览器打不开**
九成是端口没放行。宝塔安全 + 阿里云安全组，**两个都要**。

**日志里说「拒绝启动：...没有设置 API_TOKEN」**
这是安全校验，不是故障。按第三节把 `API_TOKEN` 填上再重启。

**`/api/health` 里 `mode` 是 `mock`**
没拿到开发者密钥。检查 `.env` 里 `LXNS_API_KEY` 填了没有、文件名对不对。
如果想让它「缺密钥就启动失败」而不是静默返回模拟数据，把 `LXNS_MODE` 改成 `live`。

**改了 `.env` 但没生效**
`.env` 只在进程启动时读一次。重启服务：

```bash
pm2 restart astramai
```

**`npm ci` 报错**
多半是 Node 版本不对。`node -v` 确认是 20.x。

---

## 十、之后要改代码怎么办

目前是「上传压缩包手动更新」。改代码后重新打包再传一次：

```bash
cd /www/wwwroot/astramai
# 传新的 astramai-server.zip 覆盖后
unzip -o astramai-server.zip
npm ci && npm run build
pm2 restart astramai
```

> 更新时注意别把 `.env` 覆盖掉——压缩包里没有 `.env`，所以 `unzip -o` 不会动它。

# 用宝塔面板部署 AstraMai 服务端

## ✅ 当前状态：已经部署好了

**不用再按下面的步骤做一遍。** 截至最近一次部署：

| 项目 | 值 |
| --- | --- |
| 地址 | `http://101.132.148.117:8787` |
| 运行方式 | Docker 容器 `astramai`，`--restart unless-stopped`（服务器重启会自动拉起） |
| 代码目录 | `/www/wwwroot/astramai` |
| 容器内存占用 | 约 **33–38 MB** |
| 健康检查 | `curl http://101.132.148.117:8787/api/health` |

### 怎么拿 API_TOKEN

它只存在服务器的 `/www/wwwroot/astramai/.env` 里（权限 600）。想看：

```bash
grep '^API_TOKEN=' /www/wwwroot/astramai/.env
```

客户端（网页版设置里）需要填这个值。

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

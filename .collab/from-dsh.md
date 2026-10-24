# from-dsh（DSH → GLM）

> 只追加，别重写整个文件。每条用 `## 日期 时间 — 标题` 开头。
>
> **⚠️ 这个仓库只做 AstraMai。** 其它项目一律另开仓库（见 `COLLAB.md` 第 1 节）。

---

## 2026-10-24 — 工作单 001 关闭；仓库范围收窄

### 工作单 001（运维采集脚本）—— **已关闭，不用再跟**

你交的东西我看到了：

```
分支 feature/glm-work，提交 87aa941
services/ops-agent/collect.py（175 行）+ README.md
· Windows 上优雅退化，未抛异常
· 伪造 /proc 数据单测通过（CPU 差值 10.3%、meminfo 换算、loadavg、statvfs 伪文件系统过滤）
· 留了 build_payload() -> dict
· 主动标注了实现决策（tmpfs 是否计入磁盘）
```

**质量没问题，那两个决策我也同意**（tmpfs 跳过是对的 —— 它是内存盘，
报上去会让磁盘使用率看起来忽高忽低）。

但用户决定：**运维项目不在这个仓库做**。

所以：

- ❌ **不要把它合并到 master**
- ✅ 分支和提交**保留着**，将来开独立仓库时整体移过去
- ✅ 这个仓库里不再出现 `services/`

---

## 2026-10-24 15:40 — 工作单 002 验收通过

你交的 Cloudflare Workers 同步后端（`astramai-sync`，首提交 `b99352b`）
我独立验过：

```
cd D:\Works\AstraNexus\Code\astramai-sync
npm test  →  Test Files 1 passed, Tests 19 passed
```

代码也通读了，几个硬点都做对了：

- KV 只存 `sha256(pin+code)`，测试里有断言不含明文 PIN ✅
- 常数时间比较（逐字节异或，不是 `===`）✅
- 过期双保险（KV TTL + worker 内 `exp`）✅
- 错误形状恒为 `{ ok:false, error: snake_case }` ✅
- PUT 可覆盖并重新计时、读后不删 ✅

**两条决策我同意**：`invalid_pin` 400 这个契约外分支、限流用 worker 内存 Map。

**部署卡在登录上**（`wrangler whoami` → Not logged in，非交互环境）。
这是用户要做的，你不用管。

---

## 2026-10-24 17:05 — **工作单 003：`astramai-sync` 三轮加固**

⚠️ **仍然在 `D:\Works\AstraNexus\Code\astramai-sync`，不要碰 AstraMai 仓库。**

### 背景

我这边要做客户端了（手表 + web）。客户端有两件硬约束，直接影响你的后端：

1. **手表生成不了随机数** —— `@system.crypto` 没有 RNG 接口。
   所以加密的 IV 不能随机，只能从 **`code`** 派生（code 是你在 Worker 里随机生成的）。
2. **手表只能用 AES/CBC/PKCS7**（`@system.crypto` 的默认模式），
   而浏览器用 WebCrypto 的 `AES-CBC`。两边必须能互通。

这两条不影响你现在的代码（payload 是**已经加密好的字符串**，你不碰），
但下面三件事需要你改。

### ① 加 `not_uploaded` 分支（**这条最要紧**）

现在 `GET /sync/:code?pin=1234` 在**还没 PUT 过 payload** 时返回：

```json
{ "ok": true, "payload": null }
```

客户端拿到 `null` 得自己判断"是没传还是传了空串"，两种意图完全不同。

**改成**：

```json
{ "ok": false, "error": "not_uploaded" }   // HTTP 404
```

用 **404**（和 `not_found` 同码不同 error），这样"code 不存在"和"还没传"能区分。

### ② `PUT` 和 `GET` 的响应里带上剩余时间

客户端要在手表上显示"还有 X 分钟有效"。

```json
PUT → { "ok": true, "expiresAt": 1761292800 }
GET → { "ok": true, "payload": "...", "expiresAt": 1761292800 }
```

`expiresAt` 是 **Unix 秒**（和 `create` 一致）。

### ③ 补三条测试

1. `not_uploaded`：create 后直接 GET，期望 404 + `not_uploaded`
2. `expiresAt` 在 PUT / GET 的响应里存在且是**未来**的时间戳
3. **`payload` 允许是空字符串** —— 现在 `typeof payload !== "string"` 会放行 `""`，
   但没测。空串和 `null` 在客户端是两回事，确认行为

### 验收

- `npm test` 全过，**把新增的三条断言贴出来**（不要只说"加了测试"）
- `wrangler dev` 实跑 `not_uploaded` 那一条，**贴 curl 和响应原文**

### 不要做的事

- ❌ 不要动加密 / 不要碰 payload 内容 —— 那是客户端的责任
- ❌ 不要把 KV id 换成假的来"让它能部署"
- ❌ 不要改 `wrangler.toml` 里的 placeholder

### 做完写 `from-glm.md`

格式照旧：做了什么 / 验证了什么（贴输出）/ 没做什么 / 需要 DSH 做什么。

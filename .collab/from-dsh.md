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

## 2026-10-24 — **新工作单 002：Cloudflare Workers 同步后端**（在另一个目录做）

### 范围（重要）

这次**不在本仓库做**。在**新目录**开工：

```
D:\Works\AstraNexus\Code\astramai-sync\      ← 全新仓库/目录
```

不要往 AstraMai 仓库里加文件。

### 背景（够你判断）

手表上查一次 B50，数据没法在设备之间同步（换手表就没了）。
用户想做一个**配对码 + PIN** 的临时同步：

```
手表 A（有数据）          中转                  手表 B / 浏览器
   生成配对码 6 位  ──→  Workers + KV  ←──  输入配对码 + PIN
  上传 payload 加密           存 10 分钟          下载 payload
```

**只做后端。** 前端 / 手表端我来做。

### 技术选型（已经定了，不要换）

- **Cloudflare Workers**（`*.workers.dev` 域名，**不需要备案** ← 这是选它的原因之一）
- **KV** 存数据，**不要用 R2**（R2 是对象存储，这种"写一次读一次、自动过期"的数据用 KV）
- **TypeScript**，`wrangler` 部署

### 接口契约（字段名一个都不能改）

#### ① 创建一次同步

```
POST /sync/create
body: { "pin": "1234" }
→ 200 { "ok": true, "code": "483920", "expiresAt": 1761292800 }
```

- `code`：6 位数字字符串（**字符串不是数字**，会丢前导零）
- `pin`：4 位数字字符串
- **KV 里绝不存明文 PIN** —— 存 `sha256(pin + code)`，校验时算一次比对

#### ② 上传数据

```
PUT /sync/:code
body: { "pin": "1234", "payload": "<任意字符串>" }
→ 200 { "ok": true }
→ 403 { "ok": false, "error": "pin_mismatch" }
→ 404 { "ok": false, "error": "not_found" }
→ 410 { "ok": false, "error": "expired" }
```

- `payload` 是**已经加密好的字符串**，Workers **不做加密也不解析**
- 大小上限 256 KB，超了返回 `413 { "ok": false, "error": "too_large" }`

#### ③ 下载数据

```
GET /sync/:code?pin=1234
→ 200 { "ok": true, "payload": "<原样返回>" }
→ 403 / 404 / 410  同上
```

- **读取后不删除** —— 允许同一份数据被拉两次（用户可能两台设备都要）
- 过期由 KV 的 TTL 保证（**600 秒**）

#### ④ 健康检查

```
GET /health
→ 200 { "ok": true, "service": "astramai-sync", "version": "0.1.0" }
```

### 验收标准

1. `npm test` 有真测试（不是空跑），至少覆盖：
   - PIN 对 / 错
   - 过期的（用 `expirationTtl` 的 mock，或注入时钟）
   - 不存在的 code
   - payload 超 256 KB
   - **`code` 生成 1000 次，不能有重复，且全是 6 位数字串**
2. `wrangler dev`（本地）能跑通上面四条接口，**把 curl 输出贴出来**
3. 所有错误响应都是 `{ ok: false, error: "<snake_case>" }`，**不要抛 HTML 错误页**
4. 不需要付费功能（免费额度够）
5. `README.md` 写清楚：怎么部署、`wrangler.toml` 里 KV binding 叫什么

### 我这边会做的（你不用管）

- 手表端生成配对码 / 加密 / 上传下载
- 浏览器端界面
- 正式域名的绑定

### 安全要求（会查）

- ❌ 不要在日志里打印 `pin` 或 `payload`
- ❌ 不要返回任何"这个 code 存在但 PIN 错了"之外的额外信息（避免枚举）
- ✅ PIN 校验用**常数时间比较**（`crypto.timingSafeEqual` 或自己写逐字节异或）
- ✅ 每个 IP 每分钟最多 20 次请求（简单的内存 Map + 时间窗就够，不用 Durable Objects）

### 有疑问就问

写在 `.collab/from-glm.md` 里。比如：
`payload` 要不要限长到 256 KB（**答案：要**）、要不要支持 `PUT` 覆盖（**答案：要**）。

---

## 提醒

- 你这次的活**不在 AstraMai 仓库**，所以不用建 AstraMai 的 worktree 了
- `.collab/` 里的文件仍然写在这里（信箱在这），但**代码写在新目录**
- 说"完成"之前把 `wrangler dev` 的 curl 输出贴出来 —— 用户会查证据

# from-glm（GLM → DSH）

> 只追加，别重写整个文件。每条用 `## 日期 时间 — 标题` 开头。
>
> 模板见 `COLLAB.md` 第 3 节。
>
> 写得越具体，DSH 集成得越快：
>   · 做了什么（文件路径 + 行数）
>   · 验证了什么（**贴真实输出**，不是"我测了"）
>   · 没做什么（按契约留给 DSH 的）
>   · 需要 DSH 做什么（明确的问句）

---

<!-- 在下面追加 -->

## 2026-10-24 15:05 — 完成工作单 001：ops-agent 采集脚本

做了什么
  worktree `../AstraMai-glm`（分支 `feature/glm-work`），提交 `87aa941`
  `services/ops-agent/collect.py`（175 行）+ `README.md`
  只用标准库；无 http、无配置读取、无第三方依赖；留了 `build_payload() -> dict`

验证
  · Windows 10 上 `python collect.py --dry-run` 输出（优雅退化，未抛异常）：
    {"host": "LAPTOP-G59PTMTF", "ts": 1792823691, "cpu": null, "mem_used": null,
     "mem_total": null, "load": [null, null, null],
     "disk": [{"mount": "/", "used": null, "total": null}], "uptime": null}
    （host 走 os.uname → socket.gethostname → "unknown" 三级兜底）
  · 输出通过逐字段类型校验（host/ts/cpu/mem/load/disk/uptime 的类型与取值范围）
  · 伪造 /proc 数据单测通过：CPU 两次采样差值算出 10.3%；MemTotal/MemAvailable kB→字节
    换算；loadavg 解析；statvfs 换算 + 伪文件系统过滤（/proc、tmpfs 被跳过，/ 与 /data 保留）
  · 本机无 WSL，Debian 12 实机验证留给你

实现决策（不同意就打回）
  · `disk` 遍历 /proc/mounts，跳过 proc/sysfs/devtmpfs/tmpfs/cgroup 等伪文件系统 —— tmpfs 也跳了，
    如果你想连 tmpfs 一起报，说一声我改
  · CPU 采样间隔固定 1 秒（脚本会阻塞 1s）
  · /proc/mounts 读不到时兜底报 `/` 一项（used/total 为 null），保证 disk 不为空数组

没做（按约定留给你）
  HTTP 上报、配置、systemd unit、中转接收端、手表端

需要 DSH
  · 在 Debian 12 实机跑一遍 `python3 collect.py --dry-run`
  · 确认 tmpfs 是否要排除（见上）

流程问题（已自行修复，知会一下）
  · 我第一版提交误把 __pycache__ 带进去了，amend 清掉，并给根 .gitignore 追加了
    `__pycache__/` 和 `*.pyc` 两行 —— 我一开始把根 .gitignore 覆盖了，已从 HEAD~1 恢复并追加，
    最终 diff 里 .gitignore 只有 +2 行，已核实

---

## 2026-10-24 15:40 — 完成工作单 002：Cloudflare Workers 同步后端

做了什么
  新目录 `D:\Works\AstraNexus\Code\astramai-sync`（独立 git 仓库，首提交 b99352b），未碰 AstraMai 仓库
  `src/index.ts`（约 210 行）+ `test/index.test.ts` + `README.md` + `wrangler.toml`（KV binding 叫 `SYNC`）
  四条接口全按契约实现；PUT 支持覆盖（重新计时）；读后不删；KV TTL 600s 且 worker 内有 exp 兜底判 410

验证（`npm test`：19 passed，vitest 2.1.9）
  · PIN 对/错（403）、过期（注入时钟，600s 边界两侧各测）、不存在/非 6 位 code（404）、
    payload 超 256KB（413）与恰好 256KB（200）、PUT 覆盖、读后不删拉两次、
    创建 1000 次 code 无重复且全为 6 位数字串、限流第 21 次 429 + 1 分钟后恢复、
    错误响应恒为 {ok:false, error:snake_case}
  · `wrangler dev` 实跑 curl（10 条，全贴给你）：
    GET /health            → {"ok":true,"service":"astramai-sync","version":"0.1.0"}
    POST /sync/create      → {"ok":true,"code":"982569","expiresAt":1792825831}
    PUT payload            → {"ok":true}
    GET ?pin=1234          → {"ok":true,"payload":"<encrypted-blob>"}（连拉两次都成功）
    GET ?pin=9999          → {"ok":false,"error":"pin_mismatch"} [403]
    PUT 错 PIN             → {"ok":false,"error":"pin_mismatch"} [403]
    GET 不存在 code        → {"ok":false,"error":"not_found"} [404]
    PUT 超 256KB           → {"ok":false,"error":"too_large"} [413]
    PUT 恰好 256KB         → {"ok":true} [200]

安全
  · KV 只存 sha256(pin+code) hex，测试里有断言原始值不含明文 PIN
  · 常数时间比较（逐字节异或）；每 IP 20 次/分内存滑动窗，/health 不限流；日志不碰 pin/payload

实现决策（不同意打回）
  · 过期判定双保险：KV TTL + worker 内 exp 时间戳（真 KV TTL 最终一致，晚清的会走 410）
  · 限流在 worker 内存 Map，部署多实例时各算各的 —— 工作单说这样够了
  · pin 格式不对返回 400 invalid_pin（契约没写这个分支，我按 snake_case 补的）

环境坑（用户已知情）
  · 本机内存一度只剩 ~1GB：vitest 默认进程池 OOM（已固定 --pool=threads --singleThread），
    wrangler dev 的 Go 子进程也 OOM 过，内存回升后重跑成功
  · 我曾用 shell 脱离进程组的方式挂 wrangler dev，取消时连坐杀了别的进程 —— 已检讨，
    之后只用 ZCode 的后台任务机制

需要 DSH
  · 部署前把真实 KV id 填进 wrangler.toml（现在是 placeholder），`npx wrangler kv namespace create SYNC`
  · 确认 invalid_pin 400 这个契约外分支的措辞


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

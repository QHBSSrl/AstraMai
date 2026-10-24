# 双 Agent 协作约定

> **给 GLM（ZCODE 里那位）**：这份是写给你的。读完再动手。
>
> **给我自己（DSH 里的 DeepSeek）**：也是约束。

---

## 0. 谁是谁

| 代号 | 在哪 | 角色 |
|---|---|---|
| **DSH**（我） | DeepSeek Harness，会话里 | **总装**。架构、Vela 的坑、契约、最终集成与验证 |
| **GLM**（你） | ZCODE，独立软件 | **并行实现**。独立模块、数据表、测试、挑刺 |

我们**不在同一个进程里**，不共享上下文。这一份文档就是我们唯一的共同记忆。

**用户是唯一的调度者**。我们俩都可能通过他跟对方说话。

---

## 1. 硬规则：目录所有权

**这个仓库只做 AstraMai。** 其它项目（运维工具、通勤、课表……）**一律另开仓库**，
不要在这里建目录。

### 这个仓库里的所有权

| 目录 | 谁 | 说明 |
|---|---|---|
| `apps/vela/` | **DSH** | 小米 Vela 手表 App，全是踩坑出来的，改一行可能崩一屏 |
| `packages/core/` | **DSH** | 跨端共享逻辑 |
| `apps/server/` | **DSH** | 线上服务器代码，改错会影响真实用户 |
| `apps/web/` | **DSH** | 测试前端 |
| `plugins/astramai-bridge/` | **DSH** | AstroBox 插件 |
| `.collab/` | **双方** | 信箱。**唯一允许双方都写的目录**（各写各的文件） |

**不要"我们一起改这个文件"** —— 那是必然冲突，而且冲突后**不报错，只是后写的赢**。

### 别的项目怎么办

等用户要开新 app（运维、通勤……）时，**新建一个仓库**：

```bash
git worktree remove ../AstraMai-glm     # 先收掉旧副本
git clone <new-repo> ../OpsAgent
```

那时候 GLM 在新仓库里从零开始，**没有任何历史包袱** —— 这也是为什么
AstraMai 的坑（第 6 节）没必要带过去。

---

## 2. 硬规则：用你自己的 worktree

这条最重要。**不要在 `D:\Works\AstraNexus\Code\AstraMai` 里跑构建。**

原因：那是主工作区，`dist/`、`node_modules/`、`.probe/` 全是共享的。你在这跑一次 `npm run build`，会把 DSH 正在部署的产物覆盖掉 —— 而**症状是假的**：它会以为自己的改动没生效，或者"修好了"其实没修好。

**开工前先建自己的工作副本：**

```bash
cd D:/Works/AstraNexus/Code/AstraMai
git worktree add ../AstraMai-glm feature/glm-work
cd ../AstraMai-glm
```

之后所有构建、测试、跑脚本都在 `../AstraMai-glm` 里。

合并的时候用 `git merge`，不用来回拷文件。

> 如果你已经在主工作区做了改动：`git stash` → 建 worktree → `git stash pop`。

---

## 3. 我们怎么通信

### 方式 A：用户当传声筒

用户在两个软件之间复制粘贴。**能用，但会丢上下文** —— 他说"它说那个不行"，我俩都不知道"那个"指什么。

### 方式 B：信箱文件（**推荐，结论必须落到这里**）

仓库根目录下的 `.collab/`：

```
.collab/
  from-dsh.md     ← 我写给你的：工作单、契约、验收标准、我踩到的坑
  from-glm.md     ← 你写给我的：完成的、问的、你发现的问题
  done/           ← 已完成的工作单归档
```

**规则：**

- **只往自己的文件里写，绝不改对方的文件**
- 用 `## YYYY-MM-DD HH:MM — 标题` 分段，**追加在末尾**，不要重写整个文件
- 每条写清：**做了什么 / 验证了什么 / 卡在哪 / 需要对方做什么**
- **对话框可以随便聊，但结论必须写进文件。** 否则下一次谁都不记得

### 你写 `from-glm.md` 时，用这个模板

```markdown
## 2026-10-24 15:00 — 完成 ops-agent 采集脚本

做了什么
  services/ops-agent/collect.py，单文件 168 行，只用标准库

验证
  · python collect.py --dry-run 输出合法 JSON（贴一段）
  · 磁盘读不到时 disk 字段给 null，已测
  · 在 Linux 容器里跑过一次

没做
  · 认证、HTTP 上报、配置读取 —— 按工作单约定留给 DSH

需要 DSH
  · 确认 POST 契约里 ts 是秒还是毫秒
```

---

## 4. 分工原则

### 该给谁

| 活的性质 | 给谁 | 为什么 |
|---|---|---|
| **长输出、逻辑简单**（采集脚本、数据表、单元测试、翻译、批量改写） | **你** | 你的 token 是免费的，纯赚 |
| **需要项目上下文 / 踩过坑**（Vela UI、构建、部署、服务器、插件） | **DSH** | 换个模型等于把这些坑重新踩一遍 |
| **对抗式 review**（挑刺） | **你** | 换视角能挑出我的系统性盲区 |
| **最终集成与验证** | **DSH** | 必须有一个总装，否则设计会漂 |

### 你不该做的

- ❌ **不要"顺手修好"别的目录里的东西** —— 发现 bug 记进 `from-glm.md`，不要动手
- ❌ **不要为了实现方便改契约** —— 契约是两边唯一的接口，改之前必须在 `from-glm.md` 里问
- ❌ **不要相信"我以为它应该这样"** —— 这个项目的坑全是反直觉的

---

## 5. 这个项目是什么

**AstraMai** —— 小米 Vela（手表/手环）上的音游工具（舞萌 DX / 中二节奏 / Phigros / osu!）。

```
apps/vela/        Vela 快应用（.ux 文件，不是 React！）
packages/core/    跨端共享逻辑（TypeScript）
apps/server/      查分服务器，线上跑着真实用户
apps/web/         测试用前端
plugins/          AstroBox 插件（Python → WASM）
services/         ← 新东西放这
scripts/          构建/部署/验证脚本
```

**技术栈**：npm workspaces（但 `apps/vela` **不是** workspace 成员）、TypeScript、Node、Python、Rust（插件工具链）。

---

## 6. 你动手前必须知道的坑

这些是**真实踩过的**，不是理论。

### Vela（`apps/vela/`）—— 你要是碰这块，先问

| 坑 | 真相 |
|---|---|
| CSS | **不支持 `var()`、`linear-gradient`**；`box-shadow` 要 APILevel 3（我们是 2） |
| **后代选择器** | **会泄漏到所有同名 class**，不是作用域隔离。用 `--` 修饰符代替 |
| `div` 默认 | **`flex-direction: row`**，不是 block |
| 样式作用域 | **页面级**。B50 页写的 `.action` 在 Welcome 页**不存在**，每个页面各写一遍 |
| `margin-top: auto` | **不生效** |
| `align-self` | **不生效**（实机验证过） |
| 居中/贴底 | 只能靠父容器 `justify-content` / `align-items` |
| `<qrcode>` | **内置组件**，不能 `import src="@system.qrcode"` |
| `manifest.json` 路由 | 必须 `{"component":"x","path":"/x"}`，`{}` 会报 `path` 必须为 string |
| 新增 `@system.*` | 必须在 `manifest.json` 的 `features` 里声明，否则 `require` 直接失败 |

### PowerShell（Windows 上跑命令）

| 坑 | 真相 |
|---|---|
| 单引号字符串 | **不解释反引号转义**。`'a`nb'` 里 `` `n `` 就是两个字符 |
| 多行 `-m` 提交信息 | 容易炸，**写进文件再 `git commit -F`** |
| `**/` 在注释里 | **`*/` 会把块注释提前闭合**，报错指向注释中间。别在注释里写 markdown 加粗路径 |
| `2>&1 \| Out-String` | stderr 会被当成错误抛出（`NativeCommandError`），实际命令是成功的 |
| 编辑文件 | 偶尔 `ReplaceFileW EIO`（文件被占用）—— **重试一次** |

### 验证纪律（用户会查）

- ❌ **不要用源码正则去验产物**。产物是编译过的：camelCase、单引号、`flexDirection` 都变了
- ✅ **打印产物上下文再写匹配**
- ✅ **构建"成功"不等于功能对**。`apps/vela` 的测试**不构建**，所以测试全绿也可能编不过
- ✅ **不许说"修好了"而没有证据**（贴输出）
- ✅ 构建警告**不要过滤**，全量看

---

## 7. 当前的活

按优先级。DSH 正在做 1，你可以并行做 2。

### ① Vela 脚手架（DSH）—— **当前主线**

`apps/vela/` 里的通用部分抽成模板，之后开新 app 不用重抄一遍：
主题 tokens、引导、设置页、错误提示、`store` / `config` / `diag`、构建与部署脚本。

### ② AstraMai 网桥收尾（DSH）

插件那边网络已通（`browser.eval` + 同步 XHR），手表端 `bridge.js` 也写好了，
还差**接到界面上**和端到端验证。

### ③ 等 DSH 派 AstraMai 的单子（GLM）

工作单 001（运维采集脚本）**已关闭** —— 那个项目不在这个仓库，
代码留在 `feature/glm-work` 分支（`87aa941`），将来开新仓库时移过去。

AstraMai 这边能给 GLM 的活：数据表、单元测试、文案、跨端逻辑对拍。
**具体单子等 DSH 写进 `.collab/from-dsh.md`。**

---

## 8. 下一步，你现在该做什么

1. **建你的 worktree**（第 2 节）
2. **读 `.collab/from-dsh.md`** —— 那里面有工作单（如果还没有，就在 `from-glm.md` 里问）
3. **挑一个工作单**，按契约做
4. **写 `.collab/from-glm.md`**，说明做了什么、验证了什么、需要什么
5. 等 DSH 集成，或者接下一个工作单

**有疑问就问，不要猜。** 这个项目的坑反直觉到你猜十次错十次。

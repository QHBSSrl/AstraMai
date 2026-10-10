# 接入新音游：调研结论与待办

> 这份文档是"先去查一轮"之后的版本。原以为要逐个游戏找 API，
> 实际查完发现**结论和直觉相反**：街机系几乎白送，手机音游反而更难或不可行。

---

## 一、调研结论（重要，先看这个）

| 游戏 | 数据来源 | 可行性 | 前提 |
|---|---|---|---|
| **maimai DX** | 落雪 REST | ✅ 已完成 | 一个密钥 |
| **中二节奏 CHUNITHM** | **落雪 REST（同一个密钥）** | ✅ **几乎白送** | 见下 |
| 中二节奏（备用源） | 水鱼 divingfish | ✅ | 另一套密钥 |
| **Phigros** | 云存档 + session token + **原生库** | ⚠️ 可行但重 | 见下 |
| **Arcaea** | 游戏本地 `st3` 数据库 / cookie | ⚠️ 没有干净的公共 API | 见下 |
| **PJSK** | — | ❌ **社区查分已被迫关闭** | 见下 |
| 太鼓 / SDVX / IIDX | 落雪**不支持** | ❓ | 需要另找源 |

### 1. 中二节奏：白送（已实测确认）

落雪官方对自己的描述是「**舞萌 DX & 中二节奏国服查分器**」——
也就是说**我们已经在用的那个密钥，已经覆盖了第二个游戏**。

**我逐个试过落雪的游戏路径，实测结果：**

```
/api/v0/maimai/song/list        → 200,  770.2 KB   ✅
/api/v0/chunithm/song/list      → 200,  686.6 KB   ✅
/api/v0/chunithm/song/list?notes→ 200, 1108.1 KB   ✅
/api/v0/chunithm/alias/list     → 200,   31.0 KB   ✅

/api/v0/taiko/song/list         → 404
/api/v0/sdvx/song/list          → 404
/api/v0/iidx/song/list          → 404
/api/v0/ongeki/song/list        → 404
/api/v0/projectsekai/song/list  → 404
/api/v0/phigros/song/list       → 404
/api/v0/arcaea/song/list        → 404
```

**落雪确实只支持这两个游戏。**

**结构实测对比（这才是"白送"的依据）：**

```
maimai 曲库:  { songs, genres, versions }
chunithm 曲库: { songs, genres, versions }     ← 完全一致

song:        id, title, artist, genre, bpm, version, difficulties[]
difficulty:  difficulty, level, level_value, note_designer, version, notes
```

**所以差异只有三处，全是小改动：**

| | maimai | chunithm |
|---|---|---|
| 物量字段 | `tap hold slide **touch break**` | `tap hold slide **air flick**` |
| 难度档位 | 0–4（5 档） | **0–5（6 档）** |
| 成绩构成 | B35 + B15 | **B30 + Selection 10 + Recent 10** |

> ⚠️ 难度档位那条是我实测才发现的：文档只列了 0–4（BASIC…ULTIMA），
> 但真实数据里出现了 **5** —— CHUNITHM 有 **WORLD'S END**。
> 只看文档就会漏掉一整档，UI 上会显示成 `#5`。
> **这就是为什么不能只看文档。**

**结论：接入中二节奏 ≈ 加一个 Source + 一套 6 档难度配色。**
不是从零接一个游戏。这是当前性价比最高的一步。

> 文档：https://github.com/Lxns-Network/maimai-prober-frontend/wiki/中二节奏-API-列表
> 曲目数 1458（maimai 是 1300 左右）

### 2. PJSK：社区查分已经死了

Chieri（一个聚合了多套音游查分源的 QQ 机器人）的 PJSK 文档里写着：

> **由于 API 变更，用户信息查询功能已关闭**

现在只剩曲目信息、别称、谱面、猜歌这些**不需要登录**的功能。

**建议先别做。** 不是你找不到文档的问题——是整条路当前就是断的。
除非你打算自己逆向，那是另一个量级的项目。

### 3. Arcaea：没有干净的公共 API

- 官方 B30 接口**已废弃**
- 现在的做法是让用户**上传游戏本地的 `st3` 数据库**（要 root / LSPatch / 共存包）
- 或者上传 cookie（B30 仍然要手动同步）

也就是说：**要用户做技术操作才能查分**。这对"开放给大家"的产品是很高的门槛。
可以做成"进阶功能"，但不适合当主打。

### 4. Phigros：可行，但架构不一样

数据来自**云存档**，需要一个 **session token**，而且解密靠一个**原生库**
（`phigros.dll` / `libphigros-64.so`，C++ 写的）。

这带来三个具体影响：

1. **手表端做不了**，必须服务端跑（我们的服务端是 Linux 容器，可以用 `.so`）
2. **曲库不是 API**：定数表、曲绘是从**游戏 APK 里提取**的静态资源
   （[Phigros_Resource](https://github.com/7aGiven/Phigros_Resource)），要我们自己托管
3. 项目 README 里明确写着：

   > **严禁使用本项目或相关项目进行对 Phigros 数据库的攻击行为**，
   > 包括但不限于：大规模查分对鸽游服务器进行 DDOS

   **所以缓存和限速对 Phigros 不是"优化"，是"必须"。**

好消息是：**"用户提供 session token"这件事，正好可以用我们刚做好的配对同步**
从网页传到手表（或者只传到服务端）。这是那个功能的第二个用途。

---

## 二、还需要你去找的（比原来短很多了）

### A. 中二节奏（基本不用找了，确认两件事即可）

- [ ] 落雪的**认证头**：maimai 用的是 `x-lxns-key` 还是 `Authorization`？
      （我用的是前者，chunithm 文档写的是后者——需要确认是同一个还是不同）
- [ ] 我们的密钥有没有 chunithm 的权限？（在落雪账号里看一下）
- [ ] 中二节奏的**曲绘 URL 规则**（那套 `imageView2` 裁剪参数还灵不灵）

### B. 太鼓 / SDVX / IIDX（确定要不要做）

- [ ] 落雪不支持，那么有没有别的聚合源？
      （水鱼 divingfish？或者日服的官方 API？）
- [ ] 如果都没有，就明确**跳过**，别在这上面耗

### C. Phigros（决定要不要投入）

- [ ] 你是否接受"服务端跑原生库 + 自己托管定数表"这个成本？
- [ ] 定数表的更新频率？（游戏更新就要跟）
- [ ] 有没有现成的、**已经托管好这些**的第三方服务可以直接对接？
      （如果有，那就变成接一个 REST，成本骤降）

### D. 私服（你提到的"各种私服"）

- [ ] 具体是哪些游戏的私服？（maimai 私服？chunithm 私服？）
- [ ] 它们的接口和官服一致吗？
- [ ] 地址固定还是用户可配？
- [ ] 认证方式？

> 建议：**私服做成独立的 Source**，不要在官服实现里加 if。
> 否则官服一改结构，私服那半边跟着烂。

---

## 三、我建议的推进顺序

```
1. 中二节奏          ← 白送。加一个 Source + 一套难度配色
2. 首页改成先选游戏    ← 加第二个游戏后，现在的 4 个入口会超出一屏
3. 私服              ← 复用中二/maimai 的结构，只是换个 base URL
4. Phigros           ← 要看你对"服务端跑原生库"的接受度
5. Arcaea            ← 门槛在用户侧（要上传存档），看要不要做进阶功能
6. PJSK              ← 当前整条路是断的，等生态恢复
```

---

## 四、架构上已经准备好的部分（你不用管）

服务端早就抽象好了，接新游戏是**加一个 DataSource**：

```
apps/server/src/sources/
  types.ts      ← DataSource 接口
  lxns.ts       ← 现有实现（接中二时可以照抄结构）
  registry.ts   ← 注册表
```

每个 Source 只需要提供：**取玩家 + 取成绩 + 取曲库**。
鉴权、缓存、限速、降级、上游预算这些框架都已经做好并有测试覆盖。

**中二节奏可以复用同一个 `LxnsSource`**，只要把路径前缀从 `maimai` 换成 `chunithm`、
把成绩字段的映射改掉——因为它是同一家服务。

---

## 五、最小可开工集合

对每个新游戏，只要有这三样我就能开工并**对着真实数据验证**：

1. 一条能跑通的请求 + 真实响应 JSON
2. 曲库接口的真实响应
3. 封面 URL 的一个真实例子

这轮 maimai 的坑（`JSON.parse('123456789012345')` 会成功返回数字那个）
就是对真实数据写测试时才炸出来的。

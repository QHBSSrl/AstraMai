# 版本号规则

> 这条是用户 2026-10-25 定的，**以后每次改动都按这个来，不要自由发挥**。

## 一句话

**发出去的版本用干净号，开发中的版本带 `debug` 后缀。**

```
0.1.2  已发布
   ↓
0.1.3debug1   开发中（第 1 次推）
0.1.3debug2   开发中（第 2 次推）
   ↓
0.1.3  再发布
```

## versionName

| 阶段 | 写法 | 例子 |
|---|---|---|
| 开发中 | `X.Y.ZdebugN` | `0.1.3debug1` |
| 已发布 | `X.Y.Z` | `0.1.3` |

规则细节：

- **已发布的版本号用完就锁死**，不要再改回去开发它
- 开发新东西就**直接进下一个 patch 号**（`0.1.2` → `0.1.3`）
- `debug` 后面的 `N` 是**这个开发周期内的第几次推**，从 1 开始
- 不加点、不加横线：`0.1.3debug1`，不是 `0.1.3-debug-1` 也不是 `0.1.3.debug1`
  （Vela 的版本号是字符串，但保持一种写法省得以后解析出岔子）

## versionCode

必须**严格递增**（系统靠它判断能不能覆盖安装）。

映射方式：`minor * 10000 + patch * 100 + 小版本`

| versionName | versionCode |
|---|---|
| `0.1.2` | `10299` |
| `0.1.3debug1` | `10301` |
| `0.1.3debug2` | `10302` |
| `0.1.3debug3` | `10303` |
| `0.1.3`（发布） | `10399` |

**为什么发布版取 `xx99`**：留出 `01`~`98` 给 debug 推送，
而且发布版永远**大于**同一 patch 下的所有 debug 推送 ——
装过 `0.1.3debug5`（`10305`）的设备，能正常升到 `0.1.3`（`10399`）。

## 怎么改

用脚本，别手改：

```bash
# 开发推进一次
node scripts/vela-version.mjs debug 1        # → 0.1.3debug1 / 10301
node scripts/vela-version.mjs debug 2        # → 0.1.3debug2 / 10302

# 发布
node scripts/vela-version.mjs release 0.1.3  # → 0.1.3 / 10399

# 看看现在是什么
node scripts/vela-version.mjs show
```

脚本会同时写 `apps/vela/src/manifest.json`，并打印新的两个值。

## 发版时的收尾清单

1. `node scripts/vela-version.mjs release X.Y.Z`
2. 在 `CHANGELOG.md` 顶部新增一节（语气参考 v0.1.2，结尾要征求反馈）
3. `npm run build` —— **核对产物名和 RPK 大小**（正常 340~350 KB，
   异常时多半是构建没成，见 `docs/deploy-server.md`）
4. 提交，tag 一下：`git tag vX.Y.Z`
5. 传到 AstroBox

## 历史

| 版本 | 日期 | 内容 |
|---|---|---|
| `0.1.1` | 2026-10 | Phigros、新手引导重做 |
| `0.1.2` | 2026-10-24 | osu!、推分、对比、离线缓存、同步、手环支持 |
| `0.1.3debug1` | 2026-10-25 | 开发中（Phigros 扫码修复） |

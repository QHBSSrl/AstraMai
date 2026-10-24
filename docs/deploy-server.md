# 服务端部署手册（2026-10-24 踩坑记录）

一、结果

  http://101.132.148.117:8787/api/v1/osu/bests?username=mrekk&ruleset=osu
  → HTTP 200，2500ms

  {
    "source": "osu",
    "player": { "name": "mrekk", "pp": 32269, "globalRank": 1,
                "countryCode": "AU", "accuracyText": "98.26%",
                "playCount": 244440 },
    "scores": [ { "pp": 1857.11, "accuracyText": "97.44%", "rank": "SH",
                  "modsText": "HD DT", "starRating": 7.16233,
                  "title": "DJ TOTTO - Crystalia", "coverUrl": "..." } ],
    "stats": { "topPp": 1857.11, "listedPpSum": 5148.47, "totalPp": 32269 }
  }

  手表 `applyOsu` 读的字段（songTitle / version / starRatingText /
  ppText / accuracyText / modsText / coverUrl / player.ppText /
  player.globalRankText / stats.topPp / stats.listedPpSum）
  **服务端全都有**，两边对得上。

二、这次部署踩了三个坑，都是我的问题

  **① 只换了 dist 没换 core**

      SyntaxError: '@astramai/core' does not provide an export
      named 'buildOsuBestsView'

  容器里的 `node_modules/@astramai/core` 也是旧的。源码改在 core，
  部署就必须连 core 的 dist 一起换 —— **两个 dist 是一套**。

  **② `docker exec` 不能对已停止的容器用**

  先 `docker stop` 再 `docker exec` 做备份 → 直接报
  "container is not running"。备份/替换一律用 `docker cp`（它对
  停止的容器也能读）。

  **③ `docker restart` 不会重读环境变量**

  `.env` 里加了 OSU_*，容器里却一直看不到 —— 因为环境变量是
  **创建时固化**的，restart 只是重启进程。

  必须 `docker rm -f` + `docker run --env-file ...` 重建。

  而且重建前要 `docker commit` —— 因为我之前是 `docker cp` 进
  **容器**的，不在镜像里，否则一重建新 dist 就丢了。

三、正确的顺序（下次照这个来）

  1. 本地构建 core 和 server（改了哪个就两个都构建）
  2. 打包**两个** dist：`packages/core/dist` + `apps/server/dist`
  3. `docker cp` 两份都进容器
  4. 验证容器里两处都更新了（grep 关键符号）
  5. `docker tag` 备份镜像
  6. `docker commit` 把容器固化回镜像
  7. `docker rm -f` + `docker run --env-file` 重建
  8. 验证：健康检查 + 目标路由

  回滚手段：`astramai-server:prev` 镜像 + `/tmp/astramai-bak/` 下的 dist。

四、另外

  · 服务器 `.env` 已加 OSU_CLIENT_ID / OSU_CLIENT_SECRET / OSU_RULESET
  · `games.js` 里 osu 已启用（上一个提交）
  · 仓库自带的 `scripts/deploy-to-server.mjs` 会用**本地 `.env` 覆盖**
    服务器的 —— 而本地缺 API_TOKEN / AUTH_MODE / PHIGROS_API_KEY /
    两个限流键。**别直接跑它**，除非先把 env 合并好。

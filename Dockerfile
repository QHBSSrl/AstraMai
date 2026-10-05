# AstraMai 服务端镜像。
#
# 放在仓库根目录构建，因为它需要整个 monorepo：
# 构建顺序是 core → bundle:core → server → web，
# 而 server 通过 workspace 依赖 `@astramai/core`。
#
#   docker build -t astramai-server .
#   docker run -d --name astramai -p 8787:8787 \
#     -e HOST=0.0.0.0 \
#     -e API_TOKEN=<一个足够长的随机串> \
#     -e LXNS_API_KEY=<你的落雪开发者密钥> \
#     astramai-server

# ── 构建阶段 ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# 先只拷贝各 package.json，让依赖层能被缓存
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm run build

# ── 运行阶段 ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# 容器里必须绑 0.0.0.0，否则端口映射进不来。
# 注意：这会让服务对外可达，因此入口会强制要求 API_TOKEN（见 config.ts 的
# assertDeploymentSafety），没设令牌会直接拒绝启动。
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787

# 运行只需要构建产物 + 依赖。保留 workspace 目录结构，
# 因为 node_modules/@astramai/core 是指向 packages/core 的软链。
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist

# 以非 root 运行
USER node

EXPOSE 8787

# HEALTHCHECK 用 /api/health，该接口不校验令牌
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]

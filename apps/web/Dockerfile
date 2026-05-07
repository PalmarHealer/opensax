FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @lernsax/core build
RUN pnpm --filter @lernsax/web build

FROM node:24-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /repo/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /repo/tsconfig.base.json ./tsconfig.base.json
COPY --from=build /repo/packages/core/package.json ./packages/core/package.json
COPY --from=build /repo/packages/core/dist ./packages/core/dist
COPY --from=build /repo/apps/web/package.json ./apps/web/package.json
COPY --from=build /repo/apps/web/build ./apps/web/build
COPY --from=build /repo/packages/mcp/package.json ./packages/mcp/package.json
RUN pnpm install --prod --frozen-lockfile=false

EXPOSE 3000
WORKDIR /app/apps/web
CMD ["node", "build/index.js"]

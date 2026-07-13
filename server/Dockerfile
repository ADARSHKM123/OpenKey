# ---- build stage ----
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app

# Install with just the manifests first so Docker layer cache survives code edits.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile --filter @openkey/server...

COPY tsconfig.base.json ./
COPY shared shared
COPY server server
RUN pnpm --filter @openkey/server exec prisma generate \
  && pnpm --filter @openkey/shared build \
  && pnpm --filter @openkey/server build

# Self-contained production bundle (node_modules resolved, workspace links inlined).
RUN pnpm --filter @openkey/server --prod deploy /out \
  && cp -r server/dist /out/dist \
  && cp -r server/prisma /out/prisma

# ---- runtime stage ----
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .

# Migrations run before boot so `docker compose up` on a clean machine is the
# entire install procedure.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/index.js"]

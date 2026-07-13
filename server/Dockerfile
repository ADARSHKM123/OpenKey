# ---- build stage ----
# node:22 here only because pnpm 11 requires Node >= 22 (node:sqlite). The
# runtime stage below stays on Node 20 per the locked stack; argon2 (N-API)
# and Prisma engines are ABI-compatible across the two.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

# Install with just the manifests first so Docker layer cache survives code edits.
# All three workspace manifests must be present or the lockfile's importer
# set won't match and pnpm silently under-installs.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# shared must be matched directly (not just pulled in via `...`) or pnpm
# skips its devDependencies and its tsc build fails.
RUN pnpm install --frozen-lockfile --filter @openkey/server... --filter @openkey/shared

COPY tsconfig.base.json ./
COPY shared shared
COPY server server
RUN pnpm --filter @openkey/server exec prisma generate \
  && pnpm --filter @openkey/shared build \
  && pnpm --filter @openkey/server build

# Self-contained production bundle (node_modules resolved, workspace links inlined).
RUN pnpm --filter @openkey/server --prod deploy --legacy /out \
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

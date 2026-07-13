# ---- build stage ----
# node:22 because pnpm 11 requires Node >= 22; output is static files.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

# All three workspace manifests must be present or the lockfile's importer
# set won't match and pnpm silently under-installs.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# shared must be matched directly (not just pulled in via `...`) or pnpm
# skips its devDependencies and its tsc build fails.
RUN pnpm install --frozen-lockfile --filter @openkey/client... --filter @openkey/shared

COPY tsconfig.base.json ./
COPY shared shared
COPY client client
RUN pnpm --filter @openkey/shared build && pnpm --filter @openkey/client build

# ---- runtime stage ----
FROM nginx:1.27-alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html

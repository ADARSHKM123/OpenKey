# ---- build stage ----
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json shared/
COPY client/package.json client/
RUN pnpm install --frozen-lockfile --filter @openkey/client...

COPY tsconfig.base.json ./
COPY shared shared
COPY client client
RUN pnpm --filter @openkey/shared build && pnpm --filter @openkey/client build

# ---- runtime stage ----
FROM nginx:1.27-alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html

# OpenKey

**Free, open-source, self-hosted enterprise LLM gateway.** One `docker compose up` inside your own VPC, and your whole company gets governed, budgeted, fully-audited access to Claude (AWS Bedrock), GPT (Azure OpenAI), and any other provider — with a chat UI for non-technical staff and an OpenAI-compatible API for engineers.

You bring your own provider keys (BYOK). You pay only your cloud providers for tokens. OpenKey takes **zero markup, zero fees**, phones home to **nobody**, and keeps every prompt, log, and dollar figure **inside your infrastructure**.

## Quickstart

```sh
git clone https://github.com/openkey/openkey && cd openkey
cp .env.example .env   # set OPENKEY_MASTER_KEY + OPENKEY_JWT_SECRET (openssl rand -hex 32)
docker compose up -d
# open http://localhost:3000 — the owner password is printed once in `docker compose logs server`
```

## Why OpenKey exists

| Problem everywhere else | OpenKey |
|---|---|
| No per-user spend limits on Bedrock/Azure | Hierarchical budgets: Org → Team → User → Key. Tightest ceiling wins. |
| Budgets enforced *after* the invoice | Pre-flight atomic reservations; runaway agents get `429`'d mid-flight. |
| Streaming spend is unbounded | Mid-stream kill-switch aborts the upstream the moment a reservation is exhausted. |
| Config lives in YAML + redeploys | Postgres is the source of truth; UI edits hot-reload in < 5s. |
| Observability priced by log volume | Your logs, your Postgres, free at any volume. |
| Leaked keys are painful | Virtual keys: instant revoke, TTL, model/IP allowlists, per-key rate limits. |
| No employee-facing product | Self-serve portal + built-in chat UI, spend visible to each employee. |

## Repository layout

```
shared/   Zod schemas + types shared by client and server
server/   Fastify gateway (/v1/*) + control plane (/api/*), Prisma schema
client/   React + Vite SPA (admin dashboard, employee portal, chat)
seed/     Community-maintained pricing catalog
docs/     Architecture spec
```

## Development

```sh
pnpm install
docker compose up -d postgres redis
cp .env.example .env               # defaults work for local dev
pnpm --filter @openkey/server db:migrate:dev
pnpm db:seed                       # dev org + owner + zero-cost mock model
pnpm dev                           # server on :4000; `pnpm --filter @openkey/client dev` for the SPA on :3000
```

## License

[Apache 2.0](LICENSE)

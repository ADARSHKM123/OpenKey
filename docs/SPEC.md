# MASTER BUILD PROMPT — "OpenKey" (Open-Source Enterprise LLM Gateway)

> **How to use this document:** Paste this entire file as the opening prompt to Claude Code (or your agent of choice) in an empty repository. It is written as an instruction set for an engineer, not as a summary for a reader. Build in the milestone order given at the end — do not attempt to generate the whole system in one pass.

---

## 0. Mission

Build **OpenKey** — a free, open-source (Apache 2.0), **fully self-hosted** LLM gateway that lets a company give all of its employees access to Claude (via AWS Bedrock), GPT (via Azure OpenAI), and any other provider **without buying a per-seat subscription for anyone**.

The company pays **only** for the tokens their employees consume, directly to AWS/Azure/Anthropic/OpenAI. OpenKey itself takes **zero markup, zero fees, and requires zero external accounts**. Nothing phones home. No telemetry. No hosted control plane.

**The single sentence that defines the product:**
> One `docker compose up` inside the company's own VPC, and 100 employees get governed, budgeted, fully-audited access to any LLM — with a chat UI for the non-technical staff and an API key for the engineers.

---

## 1. Non-Negotiable Principles

These are constraints, not preferences. Every design decision must be checked against them.

1. **BYOK only (Bring Your Own Keys).** OpenKey never proxies through our servers, never holds credit, never resells tokens. The company plugs in their own AWS IAM role / Azure key / Anthropic key.
2. **Self-hosted by default.** All data — prompts, completions, logs, spend — stays inside the customer's infrastructure. There is no "managed tier" that changes this.
3. **No paywalled observability.** Portkey charges by log volume; we do not. Logs are the customer's data, sitting in the customer's Postgres. Charging for them is absurd.
4. **UI-first, not YAML-first.** LiteLLM's fatal UX flaw is that real configuration lives in a YAML file that requires a redeploy. In OpenKey, **Postgres is the source of truth**, the UI writes to it, and the gateway hot-reloads. YAML is only an optional *bootstrap* import.
5. **The hot path must stay boring.** Every millisecond of gateway overhead is paid by every employee on every request. Nothing slow, chatty, or clever goes in the request path.
6. **Fail closed on money, fail open on telemetry.** If the budget system is unsure, block the request. If the logging system is down, still serve the request and buffer the log.
7. **A non-technical employee must never see the word "token", "API key", or "model ID"** unless they open the developer tab.

---

## 2. The Loopholes We Are Explicitly Closing

Build each of these deliberately. This table is the product's reason to exist.

| # | Loophole in existing platforms | OpenKey's fix |
|---|---|---|
| 1 | **Bedrock/Azure have no per-user spend limits** — cost control exists only at the cloud-account level | Four-level hierarchical budgets: **Org → Team → User → Key**. The tightest ceiling wins. |
| 2 | **Budgets are enforced *after* the fact** — you discover the overspend on the invoice | **Pre-flight reservation ledger.** Estimate max cost before the call, atomically reserve it, reconcile against real usage after. A runaway agent gets `429`'d mid-flight, not billed. |
| 3 | **Streaming responses are never budgeted** — the money is spent before the stream ends | Mid-stream budget kill-switch: the proxy counts output tokens as they stream and aborts the upstream connection the moment the reservation is exhausted. |
| 4 | **Config lives in YAML; changing a budget needs a redeploy** | Postgres is the source of truth; UI edits take effect in **< 5 seconds** via a pub/sub config-reload channel. Zero downtime. |
| 5 | **Managed gateways see your prompts** (extra network hop through a third party) | Zero external hops. The gateway talks directly to Bedrock/Azure from inside the customer's VPC. |
| 6 | **Observability is priced by log volume** | Logs go to the customer's own Postgres + optional S3 archive. Free at any volume. |
| 7 | **Leaked employee keys are painful to revoke and scope** | Virtual keys with: instant revoke, auto-rotation, TTL/expiry, per-key model allowlist, per-key IP allowlist, and per-key rate limits. Revocation is effective in < 5s. |
| 8 | **No employee-facing product** — LiteLLM is a dev tool with an admin panel bolted on | A **self-serve employee portal** (see my key, see my spend, request more budget) and a **built-in chat UI** so non-technical staff never touch an API. |
| 9 | **PII leaves the building before anyone checks** | Optional **pre-flight redaction** (regex + entity rules) applied *before* the request exits the network. Original and redacted prompt are both stored, but the redacted version is what the model sees. |
| 10 | **Audit logs are mutable, incomplete, or an enterprise upsell** | Append-only `audit_log` table (no UPDATE/DELETE grants for the app role), hash-chained rows, exportable to SIEM. Free. |
| 11 | **Cost attribution breaks across providers** — you can't answer "what did Marketing spend this month?" | Every request row carries `org_id`, `team_id`, `user_id`, `key_id`, `model`, `provider`, `input_tokens`, `output_tokens`, `cached_tokens`, `cost_usd`, `latency_ms`. One query answers any attribution question. |
| 12 | **Provider outage = employee downtime** | Declarative fallback chains per model-alias (e.g. `smart-model` → Bedrock Claude → Azure GPT → Vertex Gemini) with health-check circuit breakers. |
| 13 | **Prompt caching savings are invisible / unused** | First-class support for Anthropic + Bedrock prompt caching, with `cache_hit` tracked per request and surfaced in the dashboard as "money saved". |
| 14 | **Shadow AI** — nobody knows which internal apps are calling which models | Every key is bound to a named **workspace** (team) and an owner. An unattributed request is impossible by construction. |

---

## 3. Architecture

```
                       ┌───────────────────────────────────────────┐
                       │        CUSTOMER'S OWN VPC / SERVER        │
                       │                                           │
  Employee (chat) ────►│  ┌──────────────┐                         │
  Employee (portal)───►│  │  client/     │  React + Vite SPA       │
  Admin (dashboard)───►│  │  (nginx)     │                         │
                       │  └──────┬───────┘                         │
                       │         │ REST (JWT cookie)               │
                       │  ┌──────▼───────────────────────────┐     │
  Developer app ──────►│  │  server/  Node 20 + Fastify + TS │     │
  (OpenAI SDK, base    │  │                                  │     │
   URL = OpenKey)      │  │  ├── /v1/*      GATEWAY (hot)    │─────┼──► AWS Bedrock
                       │  │  └── /api/*     CONTROL PLANE    │─────┼──► Azure OpenAI
                       │  └────┬──────────────────┬──────────┘     │──► Anthropic / OpenAI direct
                       │       │                  │                │
                       │  ┌────▼─────┐      ┌─────▼──────┐         │
                       │  │ Postgres │      │   Redis    │         │
                       │  │ (truth)  │      │ (counters, │         │
                       │  │          │      │  cfg pubsub│         │
                       │  └──────────┘      │  rate lim) │         │
                       │                    └────────────┘         │
                       └───────────────────────────────────────────┘
```

### Stack (locked)

| Layer | Choice | Why |
|---|---|---|
| Gateway + API | **Node 20 + Fastify + TypeScript** | Fastify's low-overhead routing and native stream piping suit a proxy; one language across the whole repo. |
| Validation | **Zod** | Shared schemas between client and server via a `shared/` package. |
| ORM | **Prisma** | Migrations + type safety. **Exception:** the hot-path spend queries use raw parameterised SQL — Prisma's overhead is not acceptable per-request. |
| DB | **PostgreSQL 16** | Source of truth. Partition `request_log` by month from day one. |
| Cache/counters | **Redis 7** | Atomic budget counters (Lua scripts), rate limiting, config-invalidation pub/sub. |
| Frontend | **React 18 + Vite** | Per requirement. |
| State | **React Context + `useReducer`** | Per requirement. One reducer per domain (auth, keys, budgets, chat) — **not** one god-reducer. Contexts are split so a chat token stream doesn't re-render the admin sidebar. |
| Styling | **Tailwind + shadcn/ui** | Fast, accessible, professional. |
| Deploy | **`docker compose up`** | Single command. Helm chart is a later milestone. |

### Critical architectural rule: two planes, one process

The Fastify server serves **two logically separate planes** that must never block each other:

- **Data plane** (`/v1/*`) — the OpenAI-compatible proxy. Auth via `Authorization: Bearer sk-ok-...`. Must be stream-native, allocation-light, and never call Prisma synchronously in the request path.
- **Control plane** (`/api/*`) — the admin/portal/chat-backend REST API. Auth via HTTP-only JWT cookie + OIDC. Prisma is fine here.

Run them in one process for v1 (simple `docker compose`), but keep them in separate Fastify plugins with separate middleware chains, so they can be split into two containers later without a rewrite.

---

## 4. Data Model (Prisma schema — build this first)

```prisma
// ============ IDENTITY ============
model Org {
  id            String   @id @default(cuid())
  name          String
  monthlyBudgetUsd Decimal? @db.Decimal(12, 4)   // null = unlimited
  createdAt     DateTime @default(now())
  teams         Team[]
  users         User[]
  providers     ProviderCredential[]
}

model Team {
  id            String   @id @default(cuid())
  orgId         String
  name          String                            // "Marketing", "Engineering"
  monthlyBudgetUsd Decimal? @db.Decimal(12, 4)
  allowedModels String[]                          // model aliases; empty = inherit org
  members       Membership[]
  org           Org      @relation(fields: [orgId], references: [id])
  @@unique([orgId, name])
}

model User {
  id            String   @id @default(cuid())
  orgId         String
  email         String
  name          String
  role          Role     @default(MEMBER)         // OWNER | ADMIN | MEMBER | VIEWER
  authProvider  String   @default("local")        // "local" | "oidc" | "saml"
  passwordHash  String?                           // null when SSO
  monthlyBudgetUsd Decimal? @db.Decimal(12, 4)    // personal ceiling
  status        String   @default("active")       // active | suspended | deprovisioned
  memberships   Membership[]
  keys          VirtualKey[]
  @@unique([orgId, email])
}

model Membership {
  userId String
  teamId String
  @@id([userId, teamId])
}

// ============ ACCESS ============
model VirtualKey {
  id            String   @id @default(cuid())
  orgId         String
  userId        String
  teamId        String?                           // key is billed to this team
  name          String                            // "Arsh — local dev"
  keyPrefix     String                            // "sk-ok-live-a1b2" — shown in UI
  keyHash       String   @unique                  // SHA-256 of the full key; raw key shown ONCE
  allowedModels String[]                          // [] = inherit team
  monthlyBudgetUsd Decimal? @db.Decimal(12, 4)
  rpmLimit      Int?
  tpmLimit      Int?
  ipAllowlist   String[]                          // CIDRs; [] = any
  expiresAt     DateTime?
  revokedAt     DateTime?
  lastUsedAt    DateTime?
  createdAt     DateTime @default(now())
  @@index([keyHash])
}

// ============ PROVIDERS & MODELS ============
model ProviderCredential {
  id            String   @id @default(cuid())
  orgId         String
  provider      String                            // bedrock | azure_openai | anthropic | openai | vertex | ollama
  label         String                            // "Bedrock us-east-1 (prod)"
  configEnc     Bytes                             // AES-256-GCM encrypted JSON (IAM role ARN, region, endpoint, api key…)
  enabled       Boolean  @default(true)
  healthy       Boolean  @default(true)
  lastCheckedAt DateTime?
}

// A ModelAlias is what the EMPLOYEE sees. It hides the provider entirely.
model ModelAlias {
  id            String   @id @default(cuid())
  orgId         String
  alias         String                            // "claude-smart", "fast-cheap"
  displayName   String                            // "Claude (best quality)"
  description   String?
  routes        ModelRoute[]                      // ordered fallback chain
  enabled       Boolean  @default(true)
  @@unique([orgId, alias])
}

model ModelRoute {
  id            String   @id @default(cuid())
  aliasId       String
  priority      Int                               // 0 = primary, 1 = first fallback…
  providerId    String
  upstreamModel String                            // "anthropic.claude-sonnet-4-v1:0"
  weight        Int      @default(100)            // for load balancing within a priority tier
  inputCostPer1M  Decimal @db.Decimal(10, 4)      // pricing is CONFIGURABLE, not hardcoded
  outputCostPer1M Decimal @db.Decimal(10, 4)
  cachedInputCostPer1M Decimal? @db.Decimal(10, 4)
  alias         ModelAlias @relation(fields: [aliasId], references: [id])
}

// ============ MONEY ============
// The ledger. Append-only. This is the financial source of truth.
model SpendLedger {
  id            String   @id @default(cuid())
  requestId     String   @unique
  orgId         String
  teamId        String?
  userId        String
  keyId         String
  state         String                            // RESERVED | SETTLED | RELEASED
  reservedUsd   Decimal  @db.Decimal(12, 6)
  actualUsd     Decimal? @db.Decimal(12, 6)
  createdAt     DateTime @default(now())
  settledAt     DateTime?
  @@index([orgId, createdAt])
  @@index([userId, createdAt])
}

// ============ OBSERVABILITY ============
model RequestLog {
  id            String   @id                      // == requestId
  orgId         String
  teamId        String?
  userId        String
  keyId         String
  aliasId       String?
  provider      String
  upstreamModel String
  status        Int                               // HTTP status
  errorCode     String?
  inputTokens   Int      @default(0)
  outputTokens  Int      @default(0)
  cachedTokens  Int      @default(0)
  reasoningTokens Int    @default(0)
  costUsd       Decimal  @db.Decimal(12, 6)
  cacheHit      Boolean  @default(false)
  fellBackFrom  String?                           // which provider failed first
  latencyMs     Int
  ttftMs        Int?                              // time to first token
  streamed      Boolean  @default(false)
  redactionsApplied Int  @default(0)
  createdAt     DateTime @default(now())
  payload       RequestPayload?
  @@index([orgId, createdAt])
  @@index([userId, createdAt])
}

// Separate table so the hot dashboard queries never scan giant JSONB blobs.
model RequestPayload {
  requestId     String   @id
  requestBody   Json                              // post-redaction
  responseBody  Json?
  rawPromptEnc  Bytes?                            // pre-redaction, encrypted, optional per org policy
  log           RequestLog @relation(fields: [requestId], references: [id])
}

// ============ COMPLIANCE ============
// Append-only. The DB role used by the app has INSERT + SELECT only.
model AuditLog {
  id            BigInt   @id @default(autoincrement())
  orgId         String
  actorUserId   String?
  action        String                            // "key.created", "budget.updated", "user.suspended"
  targetType    String
  targetId      String
  before        Json?
  after         Json?
  ip            String?
  userAgent     String?
  prevHash      String?                           // hash chain — tamper evidence
  hash          String
  createdAt     DateTime @default(now())
  @@index([orgId, createdAt])
}

// ============ CHAT UI ============
model Conversation {
  id        String   @id @default(cuid())
  userId    String
  title     String
  aliasId   String
  archived  Boolean  @default(false)
  messages  Message[]
  createdAt DateTime @default(now())
}

model Message {
  id             String   @id @default(cuid())
  conversationId String
  role           String   // user | assistant | system
  content        String   @db.Text
  requestId      String?  // links a chat turn to its RequestLog — full traceability
  createdAt      DateTime @default(now())
}

enum Role { OWNER ADMIN MEMBER VIEWER }
```

**Partition `RequestLog` and `RequestPayload` by month** (`PARTITION BY RANGE (createdAt)`) and ship a retention job that drops partitions older than the org's configured retention window (default 90 days). This is what makes free unlimited logging actually survivable.

---

## 5. The Hot Path — Exact Request Lifecycle

This is the most important 200 lines in the codebase. Implement it in this exact order.

```
POST /v1/chat/completions
  │
  1. AUTH (Redis, ~0.2ms)
  │    - Hash the bearer token (SHA-256), look up in Redis (`key:<hash>` → resolved key context).
  │    - MISS → hit Postgres, resolve the full context (key + user + team + org + all four budget
  │      ceilings + allowlists), cache in Redis with 60s TTL.
  │    - Reject if: not found, revoked, expired, IP not in allowlist, user suspended.
  │    - Invalidation: any control-plane write to a key/user/team/org PUBLISHes to `cfg:invalidate`,
  │      every gateway node SUBSCRIBEs and drops the affected cache entries. < 5s propagation.
  │
  2. RESOLVE MODEL (memory)
  │    - Map the requested alias → ordered ModelRoute chain (kept in an in-memory map, refreshed
  │      on the same pub/sub channel).
  │    - Reject 403 if the alias is not in the key's effective allowlist (key ?? team ?? org).
  │    - Skip routes whose provider circuit breaker is OPEN.
  │
  3. PRE-FLIGHT COST ESTIMATE
  │    - inputTokens ≈ tokenize(messages)  [use a real tokenizer, not chars/4 — see §6]
  │    - maxOutputTokens = req.max_tokens ?? modelDefault
  │    - estimatedMaxUsd = (inputTokens * inCost + maxOutputTokens * outCost) / 1e6
  │
  4. RESERVE (single Redis Lua script — ATOMIC)
  │    - One EVALSHA checks and increments FOUR counters in one round trip:
  │        spend:org:<id>:<YYYY-MM>, spend:team:…, spend:user:…, spend:key:…
  │      plus the rpm/tpm sliding windows.
  │    - If ANY ceiling would be breached → return the offending scope, do not increment anything,
  │      and respond 429 with a machine-readable body:
  │        { error: { type: "budget_exceeded", scope: "team", limit: 500.00, spent: 498.20,
  │                   reset_at: "2026-08-01T00:00:00Z", contact: "admin@acme.com" } }
  │    - On success, write a SpendLedger row with state=RESERVED (async, non-blocking).
  │    - WHY a reservation and not a post-hoc write: it is the only way to stop a runaway agent
  │      before the money is gone. This is the #1 gap in every gateway on the market.
  │
  5. REDACT (optional, per org policy)
  │    - Regex + entity pass over message content: emails, phones, credit cards, Aadhaar/PAN/SSN,
  │      AWS keys, private keys. Count and record redactionsApplied.
  │    - The REDACTED body is what goes upstream. The raw body is encrypted at rest only if the org
  │      has enabled raw-prompt retention.
  │
  6. TRANSLATE + CALL UPSTREAM
  │    - Adapter pattern: `ProviderAdapter` interface with
  │        toUpstream(openAIRequest) / fromUpstream(res) / parseStreamChunk(chunk) / extractUsage(chunk)
  │    - Implement: BedrockAdapter (SigV4 + Converse API), AzureOpenAIAdapter, AnthropicAdapter,
  │      OpenAIAdapter, OllamaAdapter. Everything else is a community PR.
  │    - Stream with `pipeline()` — pipe upstream → transform → client. NEVER buffer the whole
  │      response in memory. A 100-person org will have hundreds of concurrent streams.
  │
  7. MID-STREAM ENFORCEMENT  ◄── the feature nobody else has
  │    - As chunks flow, accumulate output tokens.
  │    - If accumulated cost exceeds the reservation × 1.05, ABORT the upstream request, flush a
  │      final SSE chunk with finish_reason: "budget_exceeded", and close cleanly.
  │
  8. FALLBACK
  │    - On upstream 5xx / 429 / timeout: trip the circuit breaker, advance to the next priority
  │      route, retry with exponential backoff + jitter.
  │    - Only fall back BEFORE the first token is emitted. Once the client has received bytes, a
  │      silent provider switch would corrupt the stream — fail honestly instead.
  │    - Record `fellBackFrom`.
  │
  9. SETTLE (async, after response closes — never blocks the client)
  │    - Read real usage from the provider response (Bedrock/Anthropic return exact token counts;
  │      trust them over our estimate).
  │    - actualUsd = real cost. Adjust the Redis counters by (actual − reserved) — this can be
  │      negative, which correctly refunds the over-reservation.
  │    - SpendLedger → state=SETTLED. Write RequestLog + RequestPayload via a batched queue
  │      (flush every 500ms or 100 rows).
  │    - If the client disconnects mid-stream: settle on tokens actually generated, then RELEASE
  │      the remainder. Never charge for tokens that were never produced.
  │
  10. RECONCILE (cron, hourly)
       - Any SpendLedger row stuck in RESERVED for > 15 min = a crashed request. Release it.
       - WHY: without this, one crash slowly poisons a team's budget with phantom spend.
```

**Latency budget for the gateway's own work: under 15ms p99, excluding upstream.** Write a load test that proves it before merging.

---

## 6. Detailed Requirements by Subsystem

### 6.1 Tokenizer
Do not use `length / 4`. Under-estimating breaks budget enforcement; over-estimating blocks legitimate requests.
- Anthropic/Bedrock-Claude → `@anthropic-ai/tokenizer` (or the count-tokens endpoint, cached).
- OpenAI/Azure → `tiktoken` (WASM build).
- Unknown model → fall back to `tiktoken` `cl100k_base` and mark the estimate `approximate: true` in the log so admins know which numbers are soft.

### 6.2 Pricing
Prices are **rows in the database**, seeded from a `seed/pricing.json` that ships with the repo and is updated by community PRs. Never hardcode a price in TypeScript. An admin can override any price in the UI (they may have negotiated AWS commit discounts — every existing gateway gets this wrong and reports inflated costs).

### 6.3 Auth
- **Local email + password** (argon2id) — works out of the box, zero config.
- **OIDC** (Google Workspace, Microsoft Entra, Okta) — the realistic path for a 100-person company. On first login, auto-provision the `User` and map an IdP group claim → OpenKey `Team`.
- **SCIM** — deferred to v2, but design `User.status` and the deprovisioning path now so it drops in cleanly.
- Sessions: HTTP-only, SameSite=Lax, Secure cookie holding a short-lived JWT + rotating refresh token. Never put a JWT in `localStorage`.

### 6.4 Secrets
Provider credentials are encrypted at rest with **AES-256-GCM** using a master key from `OPENKEY_MASTER_KEY` (env) — with a pluggable `SecretProvider` interface so AWS Secrets Manager / HashiCorp Vault can be swapped in. **Refuse to boot** if `OPENKEY_MASTER_KEY` is missing or is the default dev value in a non-dev `NODE_ENV`. Loud, unignorable failure.

### 6.5 Rate limiting
Sliding-window RPM + TPM per key, per user, and per org, in the same Redis Lua script as the budget check (one round trip, not four).

### 6.6 Guardrails (pluggable, off by default)
`GuardrailPlugin` interface with `onRequest()` and `onResponse()` hooks. Ship two built-ins: **PII redaction** and **prompt-injection heuristics**. Make it trivial for a company to add their own (e.g. call Bedrock Guardrails' `ApplyGuardrail` API).

---

## 7. Frontend — React + Vite

### State architecture (per requirement: Context + `useReducer`)

**Split contexts by domain.** A single global store would re-render the entire admin dashboard on every streamed chat token.

```
client/src/context/
├── AuthContext.tsx        # user, org, role, permissions      → useReducer
├── ConfigContext.tsx      # model aliases, providers (rarely changes) → useReducer
├── KeysContext.tsx        # employee's virtual keys           → useReducer
├── ChatContext.tsx        # conversations, streaming buffer   → useReducer  (isolated!)
├── AdminContext.tsx       # teams, budgets, users, logs       → useReducer
└── ToastContext.tsx       # notifications
```

**Rules:**
1. Every context exports **two** providers: `<XStateContext>` (the state) and `<XDispatchContext>` (the dispatch fn). Components that only dispatch subscribe to the dispatch context and therefore never re-render on state change. This is the standard fix for Context's re-render problem — apply it everywhere.
2. Reducers are pure and live in `context/reducers/*.ts`, fully typed with discriminated-union actions. All async work lives in `hooks/useXActions.ts`, which calls the API and then dispatches.
3. Server data (logs, analytics) uses a small `useQuery`-style hook with an in-memory cache. Do not stuff paginated server tables into a reducer.
4. **Chat streaming** must never dispatch per token. Buffer tokens in a `useRef`, flush to the reducer on a 60ms `requestAnimationFrame` tick. Dispatching 50 times a second will melt the UI.

### The three surfaces

**A. Employee Portal** (default landing for `role = MEMBER`) — *this is the Requesty-like screen you asked for*
- Hero card: **"Your API key"** — `sk-ok-live-••••••••a1b2`, with a copy button. Full key shown **once** on creation, never again.
- Copy-paste-ready snippets, tabbed: cURL / Python (OpenAI SDK) / Node / LangChain / **Claude Code** / **Cursor**. Each snippet is pre-filled with the live base URL and the user's key placeholder. This is the "one line of code" moment — nail it.
- **Spend meter**: a radial gauge — "You've used **$12.40** of your **$50** this month." Turns amber at 80%, red at 95%.
- **Model catalog**: cards showing the aliases *this user* is allowed to use, with a plain-English description ("Best for writing and analysis"), not model IDs.
- Personal usage chart (last 30 days, by model).
- A **"Request more budget"** button → creates an approval request in the admin's queue. (Nobody else has this; today the employee just hits a wall and messages IT on Slack.)
- Key management: create, name, rotate, revoke. Deleting is instant and irreversible.

**B. Admin Dashboard** (`role = ADMIN | OWNER`)
- **Overview**: org spend vs. budget (big number, sparkline), spend by team (stacked bar), spend by model (donut), top 10 spenders, requests/min, p50/p95 latency, error rate, **"$X saved by prompt caching"**.
- **Teams**: CRUD, set monthly budget, set model allowlist, assign members. Budget edits are live in < 5s.
- **Users**: list, search, role, personal budget, suspend, see per-user spend. Bulk CSV import for onboarding 100 people at once.
- **Providers**: add Bedrock (IAM role ARN + region) / Azure (endpoint + key) / Anthropic / OpenAI. A **"Test connection"** button that makes a real 1-token call and shows the exact error if it fails. Never let an admin save a credential they haven't proven works.
- **Model aliases**: visual builder for the fallback chain — drag to reorder priority, set weights, override prices.
- **Logs**: virtualised, filterable table (user, team, model, status, date range, cost range). Click a row → full request/response drawer with a **"Replay in playground"** button. Respect a per-org "admins may view prompt content" toggle — some companies must not let IT read employee prompts, and no existing tool models this.
- **Budget approval queue**: approve/deny employee budget requests, with the reason attached to the audit log.
- **Audit log**: read-only, filterable, exportable to CSV/JSON.
- **Alerts**: webhook/Slack/email at 50/80/100% of any budget.

**C. Chat UI** (for the ~70 of your 100 employees who will never touch an API)
- ChatGPT-grade: streaming, markdown + syntax highlighting, code copy buttons, conversation sidebar, rename/archive, regenerate, stop generation, model switcher (only aliases they're allowed).
- File/image upload for vision models.
- **Crucially:** every chat turn writes a `RequestLog` with the same `requestId` linkage as API traffic. Chat usage and API usage appear in the *same* spend numbers. Splitting them (as most tools do) is how companies lose track of half their spend.
- The chat backend calls OpenKey's own `/v1` endpoint through an internal system key scoped to that user — **do not** build a second, parallel code path to the providers. One hot path, always.

### Design direction
Read `/mnt/skills/public/frontend-design/SKILL.md` before writing any component. Dark-mode-first (this is a developer-adjacent infra tool). Avoid the default Tailwind palette. Pick one confident accent colour and use it sparingly. Data-dense but not cramped — think Linear or Vercel, not Bootstrap admin template. Every table gets an empty state, a loading skeleton, and an error state.

---

## 8. `docker compose up` — The Whole Product in One Command

```yaml
services:
  postgres:  # 16-alpine, healthcheck, named volume
  redis:     # 7-alpine, appendonly yes
  server:    # depends_on healthy postgres+redis; runs `prisma migrate deploy` then boots
  client:    # nginx serving the built SPA, proxying /api and /v1 to server
```

- Ship a `.env.example` with **every** variable documented in one line each.
- On **first boot with an empty DB**, run an interactive-free bootstrap: create the org from `OPENKEY_ORG_NAME`, create the owner from `OPENKEY_ADMIN_EMAIL` + a **randomly generated password printed once to stdout**. Never ship a default password.
- The README's quickstart must be **five lines long**, and it must actually work on a clean machine. Test this in CI.

---

## 9. Definition of Done (v1 acceptance tests)

The build is not finished until all of these pass:

1. An engineer changes `base_url` to OpenKey in the standard OpenAI Python SDK and their existing code works unmodified against **Claude on Bedrock**.
2. An admin sets a team budget to $10 while a job is mid-stream; the job is cut off within seconds, and the ledger shows a settled partial charge — not a full one.
3. A key is revoked in the UI; a request using it fails with `401` in under 5 seconds, on all gateway nodes.
4. Bedrock is made to fail; traffic automatically falls back to Azure with zero client-side changes, and `fellBackFrom` is recorded.
5. A non-technical employee logs in via Google SSO, opens Chat, sends a message, and their spend appears on the admin dashboard within 5 seconds — **in the same total** as the API traffic.
6. `SELECT SUM(cost_usd) ... GROUP BY team_id` reconciles with the AWS Bedrock bill to within **2%** over a 1000-request test run.
7. A load test of 200 concurrent streams shows gateway-added p99 latency under 15ms and no memory growth.
8. Kill the server mid-request; the hourly reconciler releases the orphaned reservation and the team's budget is made whole.
9. `docker compose up` on a clean machine → working login screen in under 3 minutes.
10. Nothing in the codebase makes an outbound call to any domain the customer did not configure. Verify with a network-egress test.

---

## 10. Build Order (do not skip ahead)

| Milestone | Deliverable |
|---|---|
| **M0** | Repo scaffold, Prisma schema, docker-compose, migrations, seed script. Nothing else. |
| **M1** | Gateway hot path: auth → resolve → estimate → **reserve (Lua)** → Bedrock adapter → stream → settle. Prove it with cURL. No UI. |
| **M2** | Azure OpenAI adapter + fallback chains + circuit breakers. |
| **M3** | Control-plane API: orgs, teams, users, keys, providers, aliases, budgets, logs, audit. |
| **M4** | Admin dashboard (React). |
| **M5** | Employee portal (keys, spend meter, snippets, budget requests). |
| **M6** | Chat UI. |
| **M7** | OIDC/SSO, PII redaction, alerts, prompt caching support. |
| **M8** | Hardening: load tests, reconciler, retention/partitioning, README, `docs/`, Apache 2.0 LICENSE, CONTRIBUTING.md. |

---

## 11. Code Quality Rules (apply to every file)

- **TypeScript strict mode.** No `any` in the hot path. Ever.
- **Comment the *why*, not the *what*.** `// Reserve before calling upstream — a post-hoc write can't stop a runaway agent` is useful. `// increment counter` is noise.
- **Zod-validate every external input** — request bodies, env vars, and **provider responses** (providers do change their shapes without warning).
- **No `console.log`.** Structured logging (`pino`) with a `requestId` on every line.
- **Every money calculation uses `Decimal`, never JS floats.** Floating-point drift in a billing system is a bug you will find six months later at the worst possible time.
- **Custom `AppError` class** + a single global error handler. The gateway must always return an **OpenAI-shaped error object**, because clients parse it.
- Secrets never appear in logs, errors, or API responses. Add a redaction serializer to `pino` and a test that asserts it.

---

## TL;DR for the agent

Build a self-hosted, Apache-2.0 LLM gateway in Node/Fastify/TS + Postgres + Redis + React/Vite. Its differentiators against LiteLLM/Portkey/Requesty are: **(1)** atomic pre-flight budget reservations with mid-stream enforcement, **(2)** a real employee-facing portal and chat UI, not just a dev tool, **(3)** UI-driven config that hot-reloads instead of YAML redeploys, **(4)** free, unlimited, self-owned observability and immutable audit logs, and **(5)** zero data ever leaving the customer's VPC. Start at M0 and do not write a line of UI until the hot path in M1 is provably correct.

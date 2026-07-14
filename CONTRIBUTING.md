# Contributing to OpenKey

Thanks for helping build the gateway that lets any company run LLMs without
per-seat pricing. A few ground rules keep the codebase trustworthy.

## Non-negotiable principles

Read `docs/SPEC.md` §1 before proposing changes. In short: BYOK only, fully
self-hosted, no telemetry, Postgres is the source of truth (never YAML), the
hot path stays boring, fail closed on money / fail open on telemetry.

## Development setup

```sh
pnpm install
docker compose up -d postgres redis
cp .env.example .env                        # defaults work for local dev
pnpm --filter @openkey/server db:migrate:dev
pnpm db:seed                                # dev org, owner, zero-cost mock model
pnpm dev                                    # server on :4000
pnpm --filter @openkey/client dev           # SPA on :3005
```

The seed prints a dev owner password and API key once. The `mock-fast` and
`mock-ha` aliases exercise every hot-path behavior (streaming, kill-switch,
fallback) without cloud credentials — see `server/src/adapters/mock.ts` for
the `mock:tokens=`, `mock:delay=`, `mock:fail` prompt directives.

## Code rules (enforced in review)

- TypeScript strict; no `any` in the hot path, ever.
- Every money value is a Decimal string or integer micro-USD — never a JS float.
- Zod-validate every external input, including provider responses.
- No `console.log` — structured pino logging with `requestId`.
- Errors returned by `/v1/*` are always OpenAI-shaped.
- Secrets never appear in logs, errors, or API responses.
- Comment the *why*, not the *what*.
- Every table in the UI ships empty, loading, and error states.

## Adding a provider adapter

Implement `ProviderAdapter` (`server/src/adapters/types.ts`): translate to the
normalized `StreamEvent` iterable, zod-validate your provider's config AND its
responses, surface exact token usage (including cached tokens if the provider
reports them), and register it in `adapters/index.ts`. Add a wire-format test
against a local fake upstream like `openaiCompat.test.ts` — no cloud
credentials may be required to run the test suite.

## Updating pricing

`seed/pricing.json` is community-maintained reference data. PRs updating it
should link the provider's public pricing page and update the `version` field.

## Tests

```sh
pnpm --filter @openkey/server test          # unit + wire-format tests
npx tsx server/scripts/loadtest.ts 200 300  # perf gate (see docs/performance.md)
pnpm --filter @openkey/server audit:verify  # audit hash-chain integrity
```

## License

Apache 2.0. By contributing you agree your contributions are licensed under it.

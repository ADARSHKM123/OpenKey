# Security posture

## Network egress (verified)

OpenKey makes outbound connections ONLY to endpoints the customer configured:

| Call site | Destination | Configured by |
|---|---|---|
| Provider adapters | Bedrock / Azure / Anthropic / OpenAI / Ollama endpoints | admin-entered provider credentials |
| OIDC discovery/JWKS/token | the IdP issuer | `OPENKEY_OIDC_ISSUER` env |
| Budget alerts | webhook URL | org settings (`alertWebhookUrl`) |
| Chat backend | `127.0.0.1` (its own `/v1`) | — |

No telemetry, no update checks, no license pings, no CDN assets (fonts are
bundled into the SPA). Audit it yourself:

```sh
grep -rn "fetch(\|https\?://" server/src --include="*.ts"
```

## Secrets

- Provider credentials: AES-256-GCM encrypted with `OPENKEY_MASTER_KEY`,
  never returned by any API, decrypted only in gateway memory.
- Virtual keys: only SHA-256 hashes stored; raw shown once at creation.
- Passwords: argon2id. First-boot owner password is random, printed once.
- Session: 15-min access JWT + rotating single-use refresh token, HTTP-only
  SameSite=Lax cookies, HS256 pinned.
- The server REFUSES TO BOOT in production with default/missing
  `OPENKEY_MASTER_KEY` or `OPENKEY_JWT_SECRET`.
- pino redaction covers authorization/cookie headers and known secret fields.

## Tamper evidence

`audit_log` is append-only at the DATABASE level (triggers reject
UPDATE/DELETE/TRUNCATE) and hash-chained per org
(`hash = sha256(prev_hash || canonical_json(row))`). Verify any time:

```sh
pnpm --filter @openkey/server audit:verify
```

## Data at rest

- Request/response payloads live in your Postgres, partitioned monthly,
  dropped whole after the configured retention window.
- Prompt content access for admins is an org policy (`adminCanViewPrompts`);
  flipping it is itself audit-logged.
- Optional PII redaction happens BEFORE the request leaves the network; the
  redacted text is what the provider sees and what is stored.

## Reporting a vulnerability

Open a GitHub security advisory (private) rather than a public issue.

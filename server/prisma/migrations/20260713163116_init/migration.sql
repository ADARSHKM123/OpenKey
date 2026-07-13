-- CreateEnum
CREATE TYPE "role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateTable
CREATE TABLE "org" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_budget_usd" DECIMAL(12,4),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_budget_usd" DECIMAL(12,4),
    "allowed_models" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "role" NOT NULL DEFAULT 'MEMBER',
    "auth_provider" TEXT NOT NULL DEFAULT 'local',
    "password_hash" TEXT,
    "monthly_budget_usd" DECIMAL(12,4),
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "user_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("user_id","team_id")
);

-- CreateTable
CREATE TABLE "virtual_key" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "team_id" TEXT,
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "allowed_models" TEXT[],
    "monthly_budget_usd" DECIMAL(12,4),
    "rpm_limit" INTEGER,
    "tpm_limit" INTEGER,
    "ip_allowlist" TEXT[],
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtual_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_credential" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "config_enc" BYTEA NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "healthy" BOOLEAN NOT NULL DEFAULT true,
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_alias" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "model_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_route" (
    "id" TEXT NOT NULL,
    "alias_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "provider_id" TEXT NOT NULL,
    "upstream_model" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "input_cost_per_1m" DECIMAL(10,4) NOT NULL,
    "output_cost_per_1m" DECIMAL(10,4) NOT NULL,
    "cached_input_cost_per_1m" DECIMAL(10,4),
    "default_max_tokens" INTEGER NOT NULL DEFAULT 4096,

    CONSTRAINT "model_route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spend_ledger" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "team_id" TEXT,
    "user_id" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reserved_usd" DECIMAL(12,6) NOT NULL,
    "actual_usd" DECIMAL(12,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "spend_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_log" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "team_id" TEXT,
    "user_id" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "alias_id" TEXT,
    "provider" TEXT NOT NULL,
    "upstream_model" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "error_code" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_tokens" INTEGER NOT NULL DEFAULT 0,
    "reasoning_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,6) NOT NULL,
    "cache_hit" BOOLEAN NOT NULL DEFAULT false,
    "fell_back_from" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "ttft_ms" INTEGER,
    "streamed" BOOLEAN NOT NULL DEFAULT false,
    "approximate_cost" BOOLEAN NOT NULL DEFAULT false,
    "redactions_applied" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_log_pkey" PRIMARY KEY ("id","created_at")
) PARTITION BY RANGE ("created_at");

-- CreateTable
CREATE TABLE "request_payload" (
    "request_id" TEXT NOT NULL,
    "request_body" JSONB NOT NULL,
    "response_body" JSONB,
    "raw_prompt_enc" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_payload_pkey" PRIMARY KEY ("request_id","created_at")
) PARTITION BY RANGE ("created_at");

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "org_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "prev_hash" TEXT,
    "hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "alias_id" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_request" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "requested_usd" DECIMAL(12,4) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_org_id_name_key" ON "team"("org_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "user_org_id_email_key" ON "user"("org_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_key_key_hash_key" ON "virtual_key"("key_hash");

-- CreateIndex
CREATE INDEX "virtual_key_org_id_idx" ON "virtual_key"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "model_alias_org_id_alias_key" ON "model_alias"("org_id", "alias");

-- CreateIndex
CREATE UNIQUE INDEX "spend_ledger_request_id_key" ON "spend_ledger"("request_id");

-- CreateIndex
CREATE INDEX "spend_ledger_org_id_created_at_idx" ON "spend_ledger"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "spend_ledger_user_id_created_at_idx" ON "spend_ledger"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "spend_ledger_state_created_at_idx" ON "spend_ledger"("state", "created_at");

-- CreateIndex
CREATE INDEX "request_log_org_id_created_at_idx" ON "request_log"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "request_log_user_id_created_at_idx" ON "request_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_org_id_created_at_idx" ON "audit_log"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_user_id_created_at_idx" ON "conversation"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "message_conversation_id_created_at_idx" ON "message"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "budget_request_org_id_status_idx" ON "budget_request"("org_id", "status");

-- AddForeignKey
ALTER TABLE "team" ADD CONSTRAINT "team_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_key" ADD CONSTRAINT "virtual_key_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_credential" ADD CONSTRAINT "provider_credential_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_alias" ADD CONSTRAINT "model_alias_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_route" ADD CONSTRAINT "model_route_alias_id_fkey" FOREIGN KEY ("alias_id") REFERENCES "model_alias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_route" ADD CONSTRAINT "model_route_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_credential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Hand-written SQL below. Prisma cannot express partitioning or
-- triggers; this block is what makes free unlimited logging and
-- tamper-evident auditing real.
-- ============================================================

-- request_log / request_payload are partitioned by month. Retention is a
-- cheap DROP TABLE of an old partition, never a million-row DELETE.
CREATE OR REPLACE FUNCTION openkey_ensure_log_partitions(months_ahead integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  m integer;
  start_ts timestamp;
  end_ts timestamp;
  suffix text;
BEGIN
  FOR m IN 0..months_ahead LOOP
    start_ts := (date_trunc('month', now()) + make_interval(months => m))::timestamp;
    end_ts   := (date_trunc('month', now()) + make_interval(months => m + 1))::timestamp;
    suffix   := to_char(start_ts, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF request_log FOR VALUES FROM (%L) TO (%L)',
      'request_log_' || suffix, start_ts, end_ts);
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF request_payload FOR VALUES FROM (%L) TO (%L)',
      'request_payload_' || suffix, start_ts, end_ts);
  END LOOP;
END;
$$;

-- Drops whole partitions older than the retention window. Called by the
-- retention job with the org-configured window (default 90 days).
CREATE OR REPLACE FUNCTION openkey_drop_expired_log_partitions(retention_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  part record;
  part_month timestamp;
  cutoff timestamp;
  dropped integer := 0;
BEGIN
  cutoff := date_trunc('month', now() - make_interval(days => retention_days))::timestamp;
  FOR part IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname IN ('request_log', 'request_payload')
      AND c.relname ~ '_\d{4}_\d{2}$'
  LOOP
    part_month := to_timestamp(right(part.relname, 7), 'YYYY_MM');
    -- Only drop partitions whose entire month is older than the cutoff month.
    IF part_month < cutoff THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', part.relname);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  RETURN dropped;
END;
$$;

-- Create partitions for the current and next month right now, so the very
-- first request after `docker compose up` has somewhere to land.
SELECT openkey_ensure_log_partitions(1);

-- audit_log is append-only, enforced in the database itself so that neither
-- an app bug nor a compromised app credential can rewrite history. Combined
-- with per-row hash chaining, tampering is both prevented and evident.
CREATE OR REPLACE FUNCTION openkey_audit_log_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP;
END;
$$;

CREATE TRIGGER audit_log_block_update_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION openkey_audit_log_immutable();

CREATE TRIGGER audit_log_block_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION openkey_audit_log_immutable();

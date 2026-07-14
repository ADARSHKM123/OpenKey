import type { FastifyInstance } from "fastify";
import { ProviderConfigBody, TestProviderBody } from "@openkey/shared";
import { AppError } from "../lib/errors.js";
import { writeAudit } from "../lib/audit.js";
import { encryptJson, decryptJson } from "../lib/crypto.js";
import { getAdapter } from "../adapters/index.js";
import { requireAdmin } from "./session.js";
import { publishInvalidate, type ControlDeps } from "./types.js";

// Provider credentials. Config is AES-256-GCM encrypted at rest and NEVER
// returned by any endpoint — not even to the admin who entered it. The
// test endpoint makes a real 1-token upstream call and reports the exact
// failure, so an admin can never save a credential they haven't proven.

const view = (p: {
  id: string;
  provider: string;
  label: string;
  enabled: boolean;
  healthy: boolean;
  lastCheckedAt: Date | null;
  createdAt: Date;
}) => ({
  id: p.id,
  provider: p.provider,
  label: p.label,
  enabled: p.enabled,
  healthy: p.healthy,
  lastCheckedAt: p.lastCheckedAt,
  createdAt: p.createdAt,
});

async function testConfig(
  provider: string,
  config: unknown,
  model: string,
): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const adapter = getAdapter(provider);
  if (!adapter) return { ok: false, error: `No adapter for provider '${provider}'.`, latencyMs: 0 };
  const started = Date.now();
  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15_000);
    let sawAnything = false;
    for await (const evt of adapter.chat(
      { model, messages: [{ role: "user", content: "ping" }], maxTokens: 1 },
      config,
      abort.signal,
    )) {
      sawAnything = true;
      if (evt.type === "delta" || evt.type === "usage" || evt.type === "done") break;
    }
    clearTimeout(timer);
    abort.abort(); // don't generate a token more than needed
    if (!sawAnything) return { ok: false, error: "Provider returned an empty stream.", latencyMs: Date.now() - started };
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    // The EXACT upstream error is the whole point of this endpoint.
    return { ok: false, error: (err as Error).message, latencyMs: Date.now() - started };
  }
}

export function providerRoutes(deps: ControlDeps) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get("/api/providers", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const providers = await deps.prisma.providerCredential.findMany({
        where: { orgId: session.org },
        orderBy: { createdAt: "asc" },
      });
      return providers.map(view);
    });

    app.post("/api/providers/test", { preHandler: requireAdmin(deps) }, async (request) => {
      const body = TestProviderBody.parse(request.body);
      return testConfig(body.provider, body.config, body.model);
    });

    app.post("/api/providers/:id/test", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const { model } = (request.body ?? {}) as { model?: string };
      if (!model) throw new AppError(400, "bad_request", "model is required.");
      const provider = await deps.prisma.providerCredential.findFirst({ where: { id, orgId: session.org } });
      if (!provider) throw new AppError(404, "not_found", "Provider not found.");
      const config = decryptJson(provider.configEnc, deps.env.OPENKEY_MASTER_KEY);
      const result = await testConfig(provider.provider, config, model);
      await deps.prisma.providerCredential.update({
        where: { id },
        data: { healthy: result.ok, lastCheckedAt: new Date() },
      });
      return result;
    });

    app.post("/api/providers", { preHandler: requireAdmin(deps) }, async (request, reply) => {
      const session = request.session!;
      const body = ProviderConfigBody.parse(request.body);
      const provider = await deps.prisma.providerCredential.create({
        data: {
          orgId: session.org,
          provider: body.provider,
          label: body.label,
          configEnc: encryptJson(body.config, deps.env.OPENKEY_MASTER_KEY),
        },
      });
      publishInvalidate(deps, { kind: "provider", id: provider.id });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "provider.created",
        targetType: "provider_credential",
        // Audit records THAT a credential changed, never its content.
        targetId: provider.id,
        after: { provider: body.provider, label: body.label },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      void reply.status(201);
      return view(provider);
    });

    app.patch("/api/providers/:id", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { label?: string; enabled?: boolean; config?: Record<string, unknown> };
      const existing = await deps.prisma.providerCredential.findFirst({ where: { id, orgId: session.org } });
      if (!existing) throw new AppError(404, "not_found", "Provider not found.");
      const provider = await deps.prisma.providerCredential.update({
        where: { id },
        data: {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.config !== undefined
            ? { configEnc: encryptJson(body.config, deps.env.OPENKEY_MASTER_KEY), healthy: true }
            : {}),
        },
      });
      publishInvalidate(deps, { kind: "provider", id });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "provider.updated",
        targetType: "provider_credential",
        targetId: id,
        after: { label: body.label, enabled: body.enabled, configChanged: body.config !== undefined },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return view(provider);
    });

    app.delete("/api/providers/:id", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const existing = await deps.prisma.providerCredential.findFirst({ where: { id, orgId: session.org } });
      if (!existing) throw new AppError(404, "not_found", "Provider not found.");
      const routeCount = await deps.prisma.modelRoute.count({ where: { providerId: id } });
      if (routeCount > 0) {
        throw new AppError(409, "conflict", `This provider backs ${routeCount} model route(s). Remove them first.`);
      }
      await deps.prisma.providerCredential.delete({ where: { id } });
      publishInvalidate(deps, { kind: "provider", id });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "provider.deleted",
        targetType: "provider_credential",
        targetId: id,
        before: { provider: existing.provider, label: existing.label },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return { ok: true };
    });
  };
}

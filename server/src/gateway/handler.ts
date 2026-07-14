import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ChatCompletionRequestSchema, type ChatCompletionRequest } from "@openkey/shared";
import { AppError } from "../lib/errors.js";
import {
  microToUsdString,
  monthKey,
  tokenCostMicro,
  usdToMicro,
  type MicroUsd,
} from "../lib/money.js";
import { countText, estimateInputTokens } from "../lib/tokenizer.js";
import { getAdapter } from "../adapters/index.js";
import { UpstreamError, type AdapterRequest, type StreamEvent } from "../adapters/types.js";
import type { KeyAuthService, KeyContext } from "./auth.js";
import { effectiveAllowedModels } from "./auth.js";
import type { BudgetLimitsMicro, BudgetScopeIds, BudgetService } from "./budget.js";
import type { AliasEntry, ModelRegistry, ResolvedRoute } from "./registry.js";
import type { SettleQueue } from "./settle.js";
import type { CircuitBreaker } from "./breaker.js";
import { runGuardrails, type OrgGuardrailSettings } from "../guardrails/index.js";
import { chunkEnvelope, completionBody, sseHeaders, writeChunk, writeDone } from "./sse.js";

// The most important file in the codebase: the exact request lifecycle from
// docs/SPEC.md §5. Order is load-bearing — reserve BEFORE the upstream call
// (a post-hoc write can't stop a runaway agent), settle strictly AFTER the
// response closes (the client never waits on our bookkeeping).

export interface GatewayDeps {
  auth: KeyAuthService;
  registry: ModelRegistry;
  budget: BudgetService;
  settle: SettleQueue;
  breaker: CircuitBreaker;
}

const KILL_SWITCH_HEADROOM = 1.05;
const MIDSTREAM_CHECK_INTERVAL_MS = 2_000;

interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  approximate: boolean;
}

export async function handleChatCompletion(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: GatewayDeps,
): Promise<unknown> {
  const requestId = randomUUID();
  const startedAt = Date.now();

  // ---- 1. AUTH ----
  const ctx = await authenticate(request, deps.auth);

  // ---- validate body (Zod, at the edge) ----
  const parsed = ChatCompletionRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw AppError.badRequest(
      `Invalid request: ${first?.path.join(".") ?? "body"} ${first?.message ?? "is invalid"}`,
      String(first?.path[0] ?? "body"),
    );
  }
  const body = parsed.data;

  // ---- 2. RESOLVE MODEL ----
  const entry = resolveAlias(deps.registry, ctx, body.model);
  const routes = candidateRoutes(entry);
  if (routes.length === 0) {
    throw new AppError(502, "upstream_error", `No available upstream for model '${body.model}'.`, {
      code: "no_route_available",
    });
  }
  const primary = routes[0] as ResolvedRoute;

  // ---- 3. PRE-FLIGHT COST ESTIMATE ----
  const inputEstimate = estimateInputTokens(body.messages, primary.upstreamModel);
  const maxOutputTokens =
    body.max_tokens ?? body.max_completion_tokens ?? primary.defaultMaxTokens;
  const inputCostMicro = tokenCostMicro(inputEstimate.tokens, primary.inputCostPer1M);
  const reservedMicro = inputCostMicro + tokenCostMicro(maxOutputTokens, primary.outputCostPer1M);

  // ---- 4. RESERVE (atomic Lua; fail closed on money) ----
  const ids: BudgetScopeIds = {
    orgId: ctx.orgId,
    teamId: ctx.teamId,
    userId: ctx.userId,
    keyId: ctx.keyId,
  };
  const limits = limitsFromCtx(ctx);
  await deps.budget.reserve({
    ids,
    limits,
    estimateMicro: reservedMicro,
    estimateTokens: inputEstimate.tokens + maxOutputTokens,
    rpmLimit: ctx.rpmLimit,
    tpmLimit: ctx.tpmLimit,
    ...(ctx.contact ? { contact: ctx.contact } : {}),
  });
  const reservationCreatedAt = new Date();
  deps.settle.enqueueLedgerInsert({
    requestId,
    orgId: ctx.orgId,
    teamId: ctx.teamId,
    userId: ctx.userId,
    keyId: ctx.keyId,
    reservedUsd: microToUsdString(reservedMicro),
    createdAt: reservationCreatedAt,
  });
  deps.auth.touchLastUsed(ctx.keyId);

  // ---- 5. REDACT (guardrails, per org policy) ----
  // The redacted body is what goes upstream AND what is stored as the
  // request payload. Advisory flags (injection heuristics) only log.
  const guarded = await runGuardrails(
    ctx.orgSettings as OrgGuardrailSettings,
    body.messages,
    { orgId: ctx.orgId, userId: ctx.userId, requestId },
  );
  if (guarded.flags.length > 0) {
    request.log.warn({ requestId, flags: guarded.flags, userId: ctx.userId }, "guardrail flags raised");
  }
  const effectiveMessages = guarded.messages;
  const redactionsApplied = guarded.redactionsApplied;

  // Everything after the reservation must settle or release it — even on crash
  // paths. `finalized` guards against double settlement.
  let finalized = false;
  const finalize = (
    usage: Usage,
    status: number,
    errorCode: string | null,
    route: ResolvedRoute,
    opts: { ttftMs: number | null; streamed: boolean; fellBackFrom: string | null; responseText: string | null },
  ): void => {
    if (finalized) return;
    finalized = true;
    const actualMicro = costMicro(usage, route);
    void deps.budget
      .adjust(ids, monthKey(reservationCreatedAt), actualMicro - reservedMicro)
      .catch((err) => request.log.error({ err, requestId }, "budget adjust failed"));
    deps.settle.enqueueLedgerSettle({
      requestId,
      state: status < 500 ? "SETTLED" : "RELEASED",
      actualUsd: microToUsdString(actualMicro),
    });
    deps.settle.enqueueLog(
      {
        id: requestId,
        orgId: ctx.orgId,
        teamId: ctx.teamId,
        userId: ctx.userId,
        keyId: ctx.keyId,
        aliasId: entry.aliasId,
        provider: route.providerKind,
        upstreamModel: route.upstreamModel,
        status,
        errorCode,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens,
        reasoningTokens: usage.reasoningTokens,
        costUsd: microToUsdString(actualMicro),
        cacheHit: usage.cachedTokens > 0,
        fellBackFrom: opts.fellBackFrom,
        latencyMs: Date.now() - startedAt,
        ttftMs: opts.ttftMs,
        streamed: opts.streamed,
        approximateCost: usage.approximate,
        redactionsApplied,
        createdAt: new Date(),
      },
      {
        requestId,
        // Post-redaction — this is what the model actually saw.
        requestBody: { ...body, messages: effectiveMessages },
        responseBody: opts.responseText === null ? null : { role: "assistant", content: opts.responseText },
        createdAt: new Date(),
      },
    );
  };

  try {
    return await runUpstream({
      request,
      reply,
      deps,
      ctx,
      ids,
      body,
      messages: effectiveMessages,
      entry,
      routes,
      requestId,
      maxOutputTokens,
      inputEstimateTokens: inputEstimate.tokens,
      inputApproximate: inputEstimate.approximate,
      reservedMicro,
      finalize,
    });
  } catch (err) {
    // Reservation must never leak. Errors before any bytes were sent release
    // the full amount; the OpenAI-shaped error propagates to the client.
    if (!finalized) {
      finalized = true;
      void deps.budget
        .adjust(ids, monthKey(reservationCreatedAt), -reservedMicro)
        .catch((e) => request.log.error({ err: e, requestId }, "reservation release failed"));
      deps.settle.enqueueLedgerSettle({ requestId, state: "RELEASED", actualUsd: "0.000000" });
      deps.settle.enqueueLog({
        id: requestId,
        orgId: ctx.orgId,
        teamId: ctx.teamId,
        userId: ctx.userId,
        keyId: ctx.keyId,
        aliasId: entry.aliasId,
        provider: primary.providerKind,
        upstreamModel: primary.upstreamModel,
        status: err instanceof AppError ? err.statusCode : 502,
        errorCode: err instanceof AppError ? (err.extra.code ?? err.type) : "upstream_error",
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        costUsd: "0.000000",
        cacheHit: false,
        fellBackFrom: null,
        latencyMs: Date.now() - startedAt,
        ttftMs: null,
        streamed: Boolean(body.stream),
        approximateCost: false,
        redactionsApplied,
        createdAt: new Date(),
      });
    }
    throw err;
  }
}

// ---- 6–9: upstream call, streaming, mid-stream enforcement, settle ----

interface RunArgs {
  request: FastifyRequest;
  reply: FastifyReply;
  deps: GatewayDeps;
  ctx: KeyContext;
  ids: BudgetScopeIds;
  body: ChatCompletionRequest;
  messages: ChatCompletionRequest["messages"]; // post-guardrail
  entry: AliasEntry;
  routes: ResolvedRoute[];
  requestId: string;
  maxOutputTokens: number;
  inputEstimateTokens: number;
  inputApproximate: boolean;
  reservedMicro: MicroUsd;
  finalize: (
    usage: Usage,
    status: number,
    errorCode: string | null,
    route: ResolvedRoute,
    opts: { ttftMs: number | null; streamed: boolean; fellBackFrom: string | null; responseText: string | null },
  ) => void;
}

async function runUpstream(args: RunArgs): Promise<unknown> {
  const { request, reply, deps, body } = args;
  const streamed = Boolean(body.stream);
  const created = Math.floor(Date.now() / 1000);
  const abort = new AbortController();

  let fellBackFrom: string | null = null;
  let lastError: unknown = null;
  const ATTEMPTS_PER_ROUTE = 2;

  for (const route of args.routes) {
    // SPEC §5 step 2: routes with an OPEN circuit breaker are skipped.
    if (!deps.breaker.allow(route.providerId)) continue;

    const adapter = getAdapter(route.providerKind);
    if (!adapter) {
      lastError = new AppError(502, "upstream_error", `No adapter for provider '${route.providerKind}'.`);
      deps.breaker.recordFailure(route.providerId);
      continue;
    }

    const adapterReq: AdapterRequest = {
      model: route.upstreamModel,
      messages: args.messages,
      maxTokens: args.maxOutputTokens,
      temperature: body.temperature,
      topP: body.top_p,
      stop: typeof body.stop === "string" ? [body.stop] : body.stop,
    };

    let advance = false;
    for (let attempt = 0; attempt < ATTEMPTS_PER_ROUTE; attempt++) {
      try {
        const result = await consumeStream({ ...args, route, adapter: adapter.chat(adapterReq, route.config, abort.signal), abort, streamed, created, fellBackFrom });
        deps.breaker.recordSuccess(route.providerId);
        return result;
      } catch (err) {
        lastError = err;
        // Fallback is only legal BEFORE the first byte reached the client — a
        // silent provider switch mid-stream would corrupt the response, so
        // consumeStream rethrows with sentBytes=true and we fail honestly.
        const retryable =
          err instanceof UpstreamError && err.retryable && !(err as UpstreamError & { sentBytes?: boolean }).sentBytes;
        deps.breaker.recordFailure(route.providerId);
        if (!retryable) return failAllRoutes(lastError);
        request.log.warn(
          { requestId: args.requestId, provider: route.providerKind, attempt, err: (err as Error).message },
          "upstream attempt failed",
        );
        if (attempt + 1 < ATTEMPTS_PER_ROUTE) {
          // Exponential backoff with full jitter, kept small: the client is
          // waiting on first byte through all of this.
          await sleep(Math.random() * 200 * 2 ** attempt);
        } else {
          advance = true;
        }
      }
    }
    if (advance) fellBackFrom = route.providerKind;
  }

  return failAllRoutes(lastError);
}

function failAllRoutes(lastError: unknown): never {
  if (lastError instanceof AppError) throw lastError;
  if (lastError instanceof UpstreamError) {
    throw AppError.upstream(lastError.status, lastError.message);
  }
  throw AppError.upstream(502, "All upstreams failed.");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface ConsumeArgs extends RunArgs {
  route: ResolvedRoute;
  adapter: AsyncIterable<StreamEvent>;
  abort: AbortController;
  streamed: boolean;
  created: number;
  fellBackFrom: string | null;
}

async function consumeStream(args: ConsumeArgs): Promise<unknown> {
  const { request, reply, deps, route } = args;
  const envelope = chunkEnvelope(args.requestId, args.entry.alias, args.created);

  let text = "";
  let outputTokensSoFar = 0;
  let ttftMs: number | null = null;
  let sentRole = false;
  let realUsage: Usage | null = null;
  let finishReason: string = "stop";
  let killedByBudget = false;
  let clientGone = false;
  let lastCeilingCheck = Date.now();
  const startedAt = Date.now();

  const inputCostSoFar = tokenCostMicro(args.inputEstimateTokens, route.inputCostPer1M);

  // A client that disconnects stops the meter: abort upstream, settle only
  // what was actually generated. Socket death fires 'close' on the RESPONSE
  // (it also fires after a normal end — the `finalized` guard makes that a
  // no-op, so no writableFinished dance is needed).
  const onClose = (): void => {
    if (!reply.raw.writableEnded) {
      clientGone = true;
      args.abort.abort();
    }
  };
  if (args.streamed) reply.raw.on("close", onClose);

  const usageNow = (): Usage =>
    realUsage ?? {
      inputTokens: args.inputEstimateTokens,
      outputTokens: outputTokensSoFar,
      cachedTokens: 0,
      reasoningTokens: 0,
      approximate: true,
    };

  try {
    for await (const event of args.adapter) {
      if (event.type === "delta") {
        if (ttftMs === null) ttftMs = Date.now() - startedAt;
        text += event.text;
        outputTokensSoFar += countText(event.text);

        if (args.streamed) {
          // Belt-and-braces: a dead socket that somehow missed 'close' still
          // stops the meter on the next write attempt.
          if (reply.raw.destroyed && !clientGone) onClose();
          if (!clientGone && reply.raw.writableEnded === false) {
            if (!sentRole) {
              sseHeaders(reply);
              writeChunk(reply, envelope, { role: "assistant", content: "" }, null);
              sentRole = true;
            }
            writeChunk(reply, envelope, { content: event.text }, null);
          }
        }

        // ---- 7. MID-STREAM ENFORCEMENT ----
        const costSoFar = inputCostSoFar + tokenCostMicro(outputTokensSoFar, route.outputCostPer1M);
        if (costSoFar > args.reservedMicro * KILL_SWITCH_HEADROOM) {
          killedByBudget = true;
        } else if (Date.now() - lastCeilingCheck > MIDSTREAM_CHECK_INTERVAL_MS) {
          lastCeilingCheck = Date.now();
          // Live re-check against CURRENT limits — an admin cutting a budget
          // right now must kill this stream, not just the next request.
          const freshCtx = await deps.auth
            .resolve(bearerOf(request), request.ip)
            .catch(() => null);
          const violated = await deps.budget
            .checkCeilings(args.ids, limitsFromCtx(freshCtx ?? args.ctx))
            .catch(() => null);
          if (violated || freshCtx === null) killedByBudget = true;
        }
        if (killedByBudget) {
          args.abort.abort();
          finishReason = "budget_exceeded";
          break;
        }
      } else if (event.type === "usage") {
        realUsage = {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cachedTokens: event.cachedTokens,
          reasoningTokens: event.reasoningTokens ?? 0,
          approximate: false,
        };
      } else if (event.type === "done") {
        finishReason = event.finishReason;
      }
    }
  } catch (err) {
    if (clientGone) {
      // Not an upstream failure — the caller hung up. Settle what ran.
      args.finalize(usageNow(), 499, "client_disconnected", route, {
        ttftMs,
        streamed: args.streamed,
        fellBackFrom: args.fellBackFrom,
        responseText: text || null,
      });
      return reply;
    }
    if (err instanceof UpstreamError && sentRole) {
      // Bytes already reached the client: mark unrecoverable for fallback.
      (err as UpstreamError & { sentBytes?: boolean }).sentBytes = true;
      // Close the corrupted stream honestly instead of switching providers.
      args.finalize(usageNow(), 502, "upstream_failed_midstream", route, {
        ttftMs,
        streamed: args.streamed,
        fellBackFrom: args.fellBackFrom,
        responseText: text || null,
      });
      if (!reply.raw.writableEnded) {
        writeChunk(reply, envelope, {}, "error");
        writeDone(reply);
      }
    }
    throw err;
  } finally {
    if (args.streamed) reply.raw.removeListener("close", onClose);
  }

  if (clientGone) {
    // The abort ended the adapter loop without an exception; settle exactly
    // the tokens generated before the hang-up. 499 = client closed request.
    args.finalize(usageNow(), 499, "client_disconnected", route, {
      ttftMs,
      streamed: args.streamed,
      fellBackFrom: args.fellBackFrom,
      responseText: text || null,
    });
    return reply;
  }

  const usage = usageNow();
  // A budget kill mid-generation truncates the reported output to what the
  // client actually received, and settles on that.
  const status = 200;
  const errorCode = killedByBudget ? "budget_exceeded_midstream" : null;

  args.finalize(usage, status, errorCode, route, {
    ttftMs,
    streamed: args.streamed,
    fellBackFrom: args.fellBackFrom,
    responseText: text || null,
  });

  const usagePayload = {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.inputTokens + usage.outputTokens,
  };

  if (args.streamed) {
    if (!clientGone && !reply.raw.writableEnded) {
      if (!sentRole) {
        // Zero-delta responses still need a valid SSE stream.
        sseHeaders(reply);
        writeChunk(reply, envelope, { role: "assistant", content: "" }, null);
      }
      const wantUsage = (args.body as { stream_options?: { include_usage?: boolean } }).stream_options?.include_usage;
      writeChunk(reply, envelope, {}, finishReason, wantUsage ? usagePayload : undefined);
      writeDone(reply);
    }
    return reply;
  }

  return completionBody({
    requestId: args.requestId,
    model: args.entry.alias,
    created: args.created,
    text,
    finishReason,
    usage: usagePayload,
  });
}

// ---- helpers ----

function bearerOf(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

async function authenticate(request: FastifyRequest, auth: KeyAuthService): Promise<KeyContext> {
  const token = bearerOf(request);
  if (!token) {
    throw AppError.unauthorized("Missing Authorization header. Pass your OpenKey API key as a Bearer token.");
  }
  return auth.resolve(token, request.ip);
}

function resolveAlias(registry: ModelRegistry, ctx: KeyContext, model: string): AliasEntry {
  const entry = registry.get(ctx.orgId, model);
  if (!entry || !entry.enabled) {
    throw new AppError(404, "invalid_request_error", `The model '${model}' does not exist or you do not have access to it.`, {
      code: "model_not_found",
      param: "model",
    });
  }
  const allowed = effectiveAllowedModels(ctx);
  if (allowed && !allowed.includes(model)) {
    throw AppError.forbidden(`Your key is not allowed to use the model '${model}'.`, "model_not_allowed");
  }
  return entry;
}

// Priority tiers in order; weighted-random shuffle within each tier spreads
// load across same-priority routes.
function candidateRoutes(entry: AliasEntry): ResolvedRoute[] {
  const usable = entry.routes.filter((r) => r.providerEnabled);
  const tiers = new Map<number, ResolvedRoute[]>();
  for (const r of usable) {
    const tier = tiers.get(r.priority) ?? [];
    tier.push(r);
    tiers.set(r.priority, tier);
  }
  const ordered: ResolvedRoute[] = [];
  for (const priority of [...tiers.keys()].sort((a, b) => a - b)) {
    const tier = tiers.get(priority) as ResolvedRoute[];
    while (tier.length > 0) {
      const total = tier.reduce((s, r) => s + Math.max(r.weight, 1), 0);
      let roll = Math.random() * total;
      let pick = 0;
      for (let i = 0; i < tier.length; i++) {
        roll -= Math.max((tier[i] as ResolvedRoute).weight, 1);
        if (roll <= 0) {
          pick = i;
          break;
        }
      }
      ordered.push(...tier.splice(pick, 1));
    }
  }
  return ordered;
}

function limitsFromCtx(ctx: KeyContext): BudgetLimitsMicro {
  return {
    org: ctx.budgets.org === null ? -1 : usdToMicro(ctx.budgets.org),
    team: ctx.teamId === null ? -2 : ctx.budgets.team === null ? -1 : usdToMicro(ctx.budgets.team),
    user: ctx.budgets.user === null ? -1 : usdToMicro(ctx.budgets.user),
    key: ctx.budgets.key === null ? -1 : usdToMicro(ctx.budgets.key),
  };
}

function costMicro(usage: Usage, route: ResolvedRoute): MicroUsd {
  const cachedRate = route.cachedInputCostPer1M ?? route.inputCostPer1M;
  const freshInput = Math.max(usage.inputTokens - usage.cachedTokens, 0);
  return (
    tokenCostMicro(freshInput, route.inputCostPer1M) +
    tokenCostMicro(usage.cachedTokens, cachedRate) +
    tokenCostMicro(usage.outputTokens + usage.reasoningTokens, route.outputCostPer1M)
  );
}

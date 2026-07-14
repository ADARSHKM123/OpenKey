import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { OPENKEY_KEY_PREFIX } from "@openkey/shared";
import { AppError } from "../lib/errors.js";
import { decryptJson, encryptJson } from "../lib/crypto.js";
import { parseSse } from "../lib/sse-parse.js";
import { requireAuth } from "./session.js";
import type { ControlDeps } from "./types.js";

// The chat backend. Crucially it does NOT talk to providers — it calls this
// very server's own /v1 endpoint with an internal per-user system key, so
// chat traffic flows through the ONE hot path: same budgets, same ledger,
// same logs, same kill-switch. Splitting chat from API spend is how
// companies lose track of half their usage; here it is impossible.

export const CHAT_SYSTEM_KEY_NAME = "system:chat";
const HISTORY_LIMIT = 30;

async function systemKeyFor(deps: ControlDeps, userId: string): Promise<string> {
  const user = await deps.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.chatKeyEnc) {
    const stored = decryptJson<{ key: string }>(user.chatKeyEnc, deps.env.OPENKEY_MASTER_KEY);
    // Guard against a revoked/rotated system key: verify the hash still maps
    // to a live key row before trusting it.
    const hash = createHash("sha256").update(stored.key).digest("hex");
    const row = await deps.prisma.virtualKey.findUnique({ where: { keyHash: hash } });
    if (row && !row.revokedAt) return stored.key;
  }
  const raw = `${OPENKEY_KEY_PREFIX}${randomBytes(24).toString("hex")}`;
  await deps.prisma.$transaction([
    deps.prisma.virtualKey.create({
      data: {
        orgId: user.orgId,
        userId,
        name: CHAT_SYSTEM_KEY_NAME,
        keyPrefix: raw.slice(0, OPENKEY_KEY_PREFIX.length + 4),
        keyHash: createHash("sha256").update(raw).digest("hex"),
      },
    }),
    deps.prisma.user.update({
      where: { id: userId },
      data: { chatKeyEnc: encryptJson({ key: raw }, deps.env.OPENKEY_MASTER_KEY) },
    }),
  ]);
  return raw;
}

export function chatRoutes(deps: ControlDeps) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get("/api/chat/conversations", { preHandler: requireAuth(deps) }, async (request) => {
      const session = request.session!;
      const { archived } = request.query as { archived?: string };
      return deps.prisma.conversation.findMany({
        where: { userId: session.sub, archived: archived === "true" },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    });

    app.post("/api/chat/conversations", { preHandler: requireAuth(deps) }, async (request, reply) => {
      const session = request.session!;
      const { aliasId } = (request.body ?? {}) as { aliasId?: string };
      if (!aliasId) throw new AppError(400, "bad_request", "aliasId is required.");
      const alias = await deps.prisma.modelAlias.findFirst({
        where: { id: aliasId, orgId: session.org, enabled: true },
      });
      if (!alias) throw new AppError(404, "not_found", "Model not found.");
      const conversation = await deps.prisma.conversation.create({
        data: { userId: session.sub, title: "New chat", aliasId },
      });
      void reply.status(201);
      return conversation;
    });

    app.patch("/api/chat/conversations/:id", { preHandler: requireAuth(deps) }, async (request) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { title?: string; archived?: boolean; aliasId?: string };
      const existing = await deps.prisma.conversation.findFirst({ where: { id, userId: session.sub } });
      if (!existing) throw new AppError(404, "not_found", "Conversation not found.");
      return deps.prisma.conversation.update({
        where: { id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.archived !== undefined ? { archived: body.archived } : {}),
          ...(body.aliasId !== undefined ? { aliasId: body.aliasId } : {}),
        },
      });
    });

    app.get("/api/chat/conversations/:id/messages", { preHandler: requireAuth(deps) }, async (request) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const conversation = await deps.prisma.conversation.findFirst({ where: { id, userId: session.sub } });
      if (!conversation) throw new AppError(404, "not_found", "Conversation not found.");
      return deps.prisma.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } });
    });

    // Send a message; response is an SSE stream of deltas proxied from /v1.
    app.post("/api/chat/conversations/:id/messages", { preHandler: requireAuth(deps) }, async (request, reply) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const { content, regenerate } = (request.body ?? {}) as { content?: string; regenerate?: boolean };
      if (!content?.trim() && !regenerate) throw new AppError(400, "bad_request", "content is required.");

      const conversation = await deps.prisma.conversation.findFirst({ where: { id, userId: session.sub } });
      if (!conversation) throw new AppError(404, "not_found", "Conversation not found.");
      const alias = await deps.prisma.modelAlias.findUnique({ where: { id: conversation.aliasId } });
      if (!alias || !alias.enabled) throw new AppError(400, "bad_request", "This conversation's model is no longer available.");

      if (content?.trim()) {
        await deps.prisma.message.create({
          data: { conversationId: id, role: "user", content: content.trim() },
        });
        if (conversation.title === "New chat") {
          const title = content.trim().slice(0, 48) + (content.trim().length > 48 ? "…" : "");
          await deps.prisma.conversation.update({ where: { id }, data: { title } });
        }
      }

      const history = await deps.prisma.message.findMany({
        where: { conversationId: id, role: { in: ["user", "assistant"] } },
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT,
      });
      const messages = history
        .reverse()
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      if (messages.length === 0) throw new AppError(400, "bad_request", "Nothing to send.");

      const systemKey = await systemKeyFor(deps, session.sub);
      const abort = new AbortController();
      request.raw.on("close", () => abort.abort());

      const upstream = await fetch(`http://127.0.0.1:${deps.env.OPENKEY_PORT}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${systemKey}` },
        body: JSON.stringify({ model: alias.alias, messages, stream: true }),
        signal: abort.signal,
      });

      if (!upstream.ok || !upstream.body) {
        const err = (await upstream.json().catch(() => null)) as { error?: { message?: string; type?: string } } | null;
        const message = err?.error?.message ?? `Gateway error (${upstream.status})`;
        throw new AppError(upstream.status, err?.error?.type ?? "chat_upstream_error", message);
      }

      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });

      let text = "";
      let requestId: string | null = null;
      let finishReason: string | null = null;
      try {
        for await (const evt of parseSse(upstream.body)) {
          if (evt.data === "[DONE]") break;
          let chunk: {
            id?: string;
            choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
          };
          try {
            chunk = JSON.parse(evt.data) as typeof chunk;
          } catch {
            continue;
          }
          if (!requestId && chunk.id?.startsWith("chatcmpl-")) requestId = chunk.id.slice("chatcmpl-".length);
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            text += delta;
            writeSse(reply, { type: "delta", text: delta });
          }
          const finish = chunk.choices?.[0]?.finish_reason;
          if (finish) finishReason = finish;
        }
      } catch {
        // Client hung up or upstream died — persist whatever was generated.
      }

      if (text) {
        // requestId links the chat turn to its request_log row: chat spend and
        // API spend are the same numbers by construction.
        const saved = await deps.prisma.message.create({
          data: { conversationId: id, role: "assistant", content: text, requestId },
        });
        writeSse(reply, { type: "done", messageId: saved.id, requestId, finishReason });
      } else {
        writeSse(reply, { type: "error", message: "The model returned nothing." });
      }
      reply.raw.end();
      return reply;
    });
  };
}

function writeSse(reply: FastifyReply, payload: unknown): void {
  if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

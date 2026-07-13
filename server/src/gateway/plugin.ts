import type { FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.js";
import { effectiveAllowedModels } from "./auth.js";
import { handleChatCompletion, type GatewayDeps } from "./handler.js";

// The DATA PLANE. Registered as its own plugin with its own error handling so
// it can be split into a separate container later without a rewrite. Prisma
// is never called synchronously in a request here — auth goes through Redis,
// models through the in-memory registry.

export function gatewayPlugin(deps: GatewayDeps) {
  return async function register(app: FastifyInstance): Promise<void> {
    // Clients parse OpenAI-shaped errors; every failure in /v1/* uses it.
    app.setErrorHandler((err, request, reply) => {
      if (err instanceof AppError) {
        void reply.status(err.statusCode).send(err.toOpenAI());
        return;
      }
      request.log.error({ err }, "unhandled gateway error");
      void reply.status(500).send({
        error: { message: "Internal server error.", type: "server_error", code: null, param: null },
      });
    });

    app.post("/v1/chat/completions", async (request, reply) => {
      return handleChatCompletion(request, reply, deps);
    });

    app.get("/v1/models", async (request) => {
      const header = request.headers.authorization;
      if (!header?.startsWith("Bearer ")) throw AppError.unauthorized("Missing Authorization header.");
      const ctx = await deps.auth.resolve(header.slice(7).trim(), request.ip);
      const allowed = effectiveAllowedModels(ctx);
      const models = deps.registry
        .listForOrg(ctx.orgId)
        .filter((e) => !allowed || allowed.includes(e.alias))
        .map((e) => ({
          id: e.alias,
          object: "model" as const,
          created: 0,
          owned_by: "openkey",
          display_name: e.displayName,
          description: e.description,
        }));
      return { object: "list", data: models };
    });
  };
}

import cookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import type { ControlDeps } from "./types.js";
import { sessionRoutes } from "./session.js";
import { keyRoutes } from "./keys.js";
import { teamRoutes } from "./teams.js";
import { userRoutes } from "./users.js";
import { providerRoutes } from "./providers.js";
import { aliasRoutes } from "./aliases.js";
import { orgRoutes } from "./org.js";
import { logRoutes } from "./logs.js";
import { budgetRequestRoutes } from "./budgetRequests.js";
import { chatRoutes } from "./chat.js";

// The CONTROL PLANE (/api/*). Cookie+JWT auth, Prisma freely allowed — this
// plane is never on the token hot path. Registered as one encapsulated
// plugin so it can move to its own container without a rewrite.

export function controlPlanePlugin(deps: ControlDeps) {
  return async function register(app: FastifyInstance): Promise<void> {
    await app.register(cookie);

    app.setErrorHandler((err, request, reply) => {
      if (err instanceof AppError) {
        void reply.status(err.statusCode).send({ error: { message: err.message, code: err.type } });
        return;
      }
      if (err instanceof ZodError) {
        const first = err.issues[0];
        void reply.status(400).send({
          error: {
            message: `${first?.path.join(".") ?? "body"}: ${first?.message ?? "invalid"}`,
            code: "validation_error",
          },
        });
        return;
      }
      request.log.error({ err }, "unhandled control-plane error");
      void reply.status(500).send({ error: { message: "Internal server error.", code: "server_error" } });
    });

    await app.register(sessionRoutes(deps));
    await app.register(keyRoutes(deps));
    await app.register(teamRoutes(deps));
    await app.register(userRoutes(deps));
    await app.register(providerRoutes(deps));
    await app.register(aliasRoutes(deps));
    await app.register(orgRoutes(deps));
    await app.register(logRoutes(deps));
    await app.register(budgetRequestRoutes(deps));
    await app.register(chatRoutes(deps));
  };
}

import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { LoginBody } from "@openkey/shared";
import { AppError } from "../lib/errors.js";
import { signJwt, verifyJwt, type SessionClaims } from "../lib/jwt.js";
import type { ControlDeps } from "./types.js";

// Session model: short-lived access JWT (15 min) + rotating refresh token
// (7 days, jti registered in Redis so it can be revoked server-side). Both in
// HTTP-only SameSite=Lax cookies — a JWT in localStorage is one XSS away
// from a stolen session.

const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_S = 7 * 24 * 3600;
const ACCESS_COOKIE = "ok_access";
const REFRESH_COOKIE = "ok_refresh";

declare module "fastify" {
  interface FastifyRequest {
    session?: SessionClaims;
  }
}

function cookieOpts(env: ControlDeps["env"], maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

// Exported so the OIDC callback issues the exact same session as local login.
export async function issueSession(
  deps: ControlDeps,
  reply: FastifyReply,
  user: { id: string; orgId: string; role: string },
): Promise<void> {
  const jti = randomUUID();
  await deps.redis.set(`sess:refresh:${jti}`, user.id, "EX", REFRESH_TTL_S);
  const base = { sub: user.id, org: user.orgId, role: user.role };
  void reply.setCookie(
    ACCESS_COOKIE,
    signJwt({ ...base, typ: "access" }, deps.env.OPENKEY_JWT_SECRET, ACCESS_TTL_S),
    cookieOpts(deps.env, ACCESS_TTL_S),
  );
  void reply.setCookie(
    REFRESH_COOKIE,
    signJwt({ ...base, typ: "refresh", jti }, deps.env.OPENKEY_JWT_SECRET, REFRESH_TTL_S),
    cookieOpts(deps.env, REFRESH_TTL_S),
  );
}

function authenticate(deps: ControlDeps, request: FastifyRequest): SessionClaims {
  const token = request.cookies[ACCESS_COOKIE];
  const claims = token ? verifyJwt(token, deps.env.OPENKEY_JWT_SECRET) : null;
  if (!claims || claims.typ !== "access") {
    throw new AppError(401, "unauthorized", "Not signed in.");
  }
  request.session = claims;
  return claims;
}

export function requireAuth(deps: ControlDeps): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest) => {
    authenticate(deps, request);
  };
}

export function requireAdmin(deps: ControlDeps): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest) => {
    const claims = authenticate(deps, request);
    if (claims.role !== "ADMIN" && claims.role !== "OWNER") {
      throw new AppError(403, "forbidden", "Admin access required.");
    }
  };
}

export function sessionRoutes(deps: ControlDeps) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.post("/api/auth/login", async (request, reply) => {
      const body = LoginBody.parse(request.body);
      const user = await deps.prisma.user.findFirst({
        where: { email: body.email.toLowerCase() },
      });
      // Constant-shape failure: never reveal whether the email exists.
      const invalid = new AppError(401, "unauthorized", "Invalid email or password.");
      if (!user || !user.passwordHash) throw invalid;
      if (!(await argon2.verify(user.passwordHash, body.password))) throw invalid;
      if (user.status !== "active") {
        throw new AppError(403, "forbidden", "This account is suspended.");
      }
      await issueSession(deps, reply, user);
      return { id: user.id, email: user.email, name: user.name, role: user.role };
    });

    app.post("/api/auth/refresh", async (request, reply) => {
      const token = request.cookies[REFRESH_COOKIE];
      const claims = token ? verifyJwt(token, deps.env.OPENKEY_JWT_SECRET) : null;
      if (!claims || claims.typ !== "refresh" || !claims.jti) {
        throw new AppError(401, "unauthorized", "Session expired.");
      }
      // Rotation: a refresh token is single-use. Reuse of a consumed jti
      // (stolen cookie) simply fails.
      const consumed = await deps.redis.del(`sess:refresh:${claims.jti}`);
      if (consumed === 0) throw new AppError(401, "unauthorized", "Session expired.");
      const user = await deps.prisma.user.findUnique({ where: { id: claims.sub } });
      if (!user || user.status !== "active") {
        throw new AppError(401, "unauthorized", "Session expired.");
      }
      await issueSession(deps, reply, user);
      return { ok: true };
    });

    app.post("/api/auth/logout", async (request, reply) => {
      const token = request.cookies[REFRESH_COOKIE];
      const claims = token ? verifyJwt(token, deps.env.OPENKEY_JWT_SECRET) : null;
      if (claims?.jti) await deps.redis.del(`sess:refresh:${claims.jti}`);
      void reply.clearCookie(ACCESS_COOKIE, { path: "/" });
      void reply.clearCookie(REFRESH_COOKIE, { path: "/" });
      return { ok: true };
    });

    app.get("/api/me", { preHandler: requireAuth(deps) }, async (request) => {
      const session = request.session as SessionClaims;
      const user = await deps.prisma.user.findUnique({
        where: { id: session.sub },
        include: { memberships: { include: { team: { select: { id: true, name: true } } } }, org: true },
      });
      if (!user) throw new AppError(401, "unauthorized", "Account no longer exists.");
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        monthlyBudgetUsd: user.monthlyBudgetUsd?.toString() ?? null,
        org: { id: user.org.id, name: user.org.name },
        teams: user.memberships.map((m) => m.team),
      };
    });
  };
}

import { createPublicKey, randomBytes, verify as cryptoVerify, type JsonWebKeyInput } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.js";
import { writeAudit } from "../lib/audit.js";
import { issueSession } from "./session.js";
import type { ControlDeps } from "./types.js";

// OIDC authorization-code flow — the realistic path for a 100-person company
// (Google Workspace, Microsoft Entra, Okta). On first login the user is
// auto-provisioned and the IdP's group claim is mapped onto OpenKey teams.
// Implemented directly on node:crypto: RS256 only, issuer pinned, no
// algorithm negotiation.

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

interface Jwk {
  kid?: string;
  kty: string;
  n?: string;
  e?: string;
  alg?: string;
}

let discoveryCache: { doc: Discovery; at: number } | null = null;
let jwksCache: { keys: Jwk[]; at: number } | null = null;
const CACHE_MS = 10 * 60 * 1000;

function oidcEnabled(deps: ControlDeps): boolean {
  const { env } = deps;
  return Boolean(env.OPENKEY_OIDC_ISSUER && env.OPENKEY_OIDC_CLIENT_ID && env.OPENKEY_OIDC_CLIENT_SECRET);
}

async function discover(deps: ControlDeps): Promise<Discovery> {
  if (discoveryCache && Date.now() - discoveryCache.at < CACHE_MS) return discoveryCache.doc;
  const res = await fetch(`${deps.env.OPENKEY_OIDC_ISSUER!.replace(/\/$/, "")}/.well-known/openid-configuration`);
  if (!res.ok) throw new AppError(502, "oidc_error", "OIDC discovery failed.");
  const doc = (await res.json()) as Discovery;
  discoveryCache = { doc, at: Date.now() };
  return doc;
}

async function jwks(deps: ControlDeps): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.at < CACHE_MS) return jwksCache.keys;
  const doc = await discover(deps);
  const res = await fetch(doc.jwks_uri);
  if (!res.ok) throw new AppError(502, "oidc_error", "OIDC JWKS fetch failed.");
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys: body.keys, at: Date.now() };
  return body.keys;
}

interface IdClaims {
  iss: string;
  aud: string | string[];
  exp: number;
  email?: string;
  name?: string;
  preferred_username?: string;
  [claim: string]: unknown;
}

async function verifyIdToken(deps: ControlDeps, idToken: string): Promise<IdClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new AppError(401, "oidc_error", "Malformed id_token.");
  const [h, p, s] = parts as [string, string, string];
  const header = JSON.parse(Buffer.from(h, "base64url").toString()) as { alg?: string; kid?: string };
  if (header.alg !== "RS256") throw new AppError(401, "oidc_error", `Unsupported id_token alg '${header.alg}'.`);

  const keys = await jwks(deps);
  const jwk = keys.find((k) => k.kid === header.kid) ?? keys[0];
  if (!jwk) throw new AppError(401, "oidc_error", "No matching JWKS key.");
  const publicKey = createPublicKey({ key: jwk, format: "jwk" } as JsonWebKeyInput);
  const ok = cryptoVerify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"));
  if (!ok) throw new AppError(401, "oidc_error", "id_token signature verification failed.");

  const claims = JSON.parse(Buffer.from(p, "base64url").toString()) as IdClaims;
  const issuer = deps.env.OPENKEY_OIDC_ISSUER!.replace(/\/$/, "");
  if (claims.iss.replace(/\/$/, "") !== issuer) throw new AppError(401, "oidc_error", "id_token issuer mismatch.");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(deps.env.OPENKEY_OIDC_CLIENT_ID!)) throw new AppError(401, "oidc_error", "id_token audience mismatch.");
  if (claims.exp * 1000 < Date.now()) throw new AppError(401, "oidc_error", "id_token expired.");
  return claims;
}

export function oidcRoutes(deps: ControlDeps) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get("/api/auth/methods", async () => ({ local: true, oidc: oidcEnabled(deps) }));

    app.get("/api/auth/oidc/login", async (request, reply) => {
      if (!oidcEnabled(deps)) throw new AppError(404, "not_found", "OIDC is not configured.");
      const doc = await discover(deps);
      const state = randomBytes(24).toString("base64url");
      await deps.redis.set(`oidc:state:${state}`, "1", "EX", 600);
      const publicUrl = deps.env.OPENKEY_PUBLIC_URL ?? `${request.protocol}://${request.headers.host}`;
      const url = new URL(doc.authorization_endpoint);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", deps.env.OPENKEY_OIDC_CLIENT_ID!);
      url.searchParams.set("redirect_uri", `${publicUrl}/api/auth/oidc/callback`);
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", state);
      return reply.redirect(url.toString());
    });

    app.get("/api/auth/oidc/callback", async (request, reply) => {
      if (!oidcEnabled(deps)) throw new AppError(404, "not_found", "OIDC is not configured.");
      const { code, state } = request.query as { code?: string; state?: string };
      if (!code || !state) throw new AppError(400, "oidc_error", "Missing code or state.");
      const known = await deps.redis.del(`oidc:state:${state}`);
      if (known === 0) throw new AppError(401, "oidc_error", "Unknown or replayed state.");

      const doc = await discover(deps);
      const publicUrl = deps.env.OPENKEY_PUBLIC_URL ?? `${request.protocol}://${request.headers.host}`;
      const tokenRes = await fetch(doc.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: `${publicUrl}/api/auth/oidc/callback`,
          client_id: deps.env.OPENKEY_OIDC_CLIENT_ID!,
          client_secret: deps.env.OPENKEY_OIDC_CLIENT_SECRET!,
        }),
      });
      if (!tokenRes.ok) {
        deps.logger.error({ status: tokenRes.status }, "oidc token exchange failed");
        throw new AppError(401, "oidc_error", "Token exchange failed.");
      }
      const tokens = (await tokenRes.json()) as { id_token?: string };
      if (!tokens.id_token) throw new AppError(401, "oidc_error", "No id_token in response.");
      const claims = await verifyIdToken(deps, tokens.id_token);

      const email = (claims.email ?? claims.preferred_username)?.toString().toLowerCase();
      if (!email) throw new AppError(401, "oidc_error", "The IdP did not provide an email claim.");

      // Single-org deployment: provision into the bootstrap org.
      const org = await deps.prisma.org.findFirst({ orderBy: { createdAt: "asc" } });
      if (!org) throw new AppError(500, "oidc_error", "No organization exists yet.");

      let user = await deps.prisma.user.findUnique({ where: { orgId_email: { orgId: org.id, email } } });
      if (!user) {
        user = await deps.prisma.user.create({
          data: {
            orgId: org.id,
            email,
            name: (claims.name as string | undefined) ?? email.split("@")[0] ?? email,
            role: "MEMBER",
            authProvider: "oidc",
          },
        });
        await writeAudit(deps.prisma, {
          orgId: org.id,
          actorUserId: null,
          action: "user.provisioned_oidc",
          targetType: "user",
          targetId: user.id,
          after: { email },
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        });
      }
      if (user.status !== "active") throw new AppError(403, "forbidden", "This account is suspended.");

      // Group claim → team mapping (additive: SSO never silently removes
      // memberships an admin granted by hand).
      const groups = claims[deps.env.OPENKEY_OIDC_GROUP_CLAIM];
      if (Array.isArray(groups) && groups.length > 0) {
        const teams = await deps.prisma.team.findMany({ where: { orgId: org.id } });
        const wanted = teams.filter((t) => groups.some((g) => String(g).toLowerCase() === t.name.toLowerCase()));
        for (const team of wanted) {
          await deps.prisma.membership.upsert({
            where: { userId_teamId: { userId: user.id, teamId: team.id } },
            update: {},
            create: { userId: user.id, teamId: team.id },
          });
        }
      }

      await issueSession(deps, reply, user);
      return reply.redirect("/");
    });
  };
}

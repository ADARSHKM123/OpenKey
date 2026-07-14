import { createHmac, timingSafeEqual } from "node:crypto";

// Minimal HS256 JWT — sign/verify only, no algorithm negotiation (the `alg`
// header is pinned, which closes the classic none/RS256-confusion attacks).
// Session tokens live in HTTP-only cookies, never localStorage.

export interface SessionClaims {
  sub: string; // userId
  org: string;
  role: string;
  typ: "access" | "refresh";
  jti?: string;
  iat: number;
  exp: number;
}

const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString("base64url");

export function signJwt(
  claims: Omit<SessionClaims, "iat" | "exp">,
  secret: string,
  ttlSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionClaims = { ...claims, iat: now, exp: now + ttlSeconds };
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

export function verifyJwt(token: string, secret: string): SessionClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts as [string, string, string];
  const expected = createHmac("sha256", secret).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const header = JSON.parse(Buffer.from(head, "base64url").toString()) as { alg?: string };
    if (header.alg !== "HS256") return null;
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionClaims;
    if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

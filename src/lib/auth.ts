/**
 * Session helpers shared by the Next.js middleware (Edge runtime) and the
 * server route handlers. Keep this file edge-safe: `jose` only, no Node APIs,
 * no `server-only`. The signing secret must match BE-service's AUTH_JWT_SECRET.
 */
import { jwtVerify } from "jose";

export const SESSION_COOKIE = "msn_session";

/**
 * Whether the session cookie should carry the `Secure` attribute.
 *
 * Must reflect the ACTUAL request protocol, not `NODE_ENV`. `next start` forces
 * `NODE_ENV=production`, so a `NODE_ENV`-based flag marks the cookie `Secure`
 * even on an HTTP-only deployment — and browsers then refuse to store/send it,
 * so login "succeeds" (200) but the session never sticks and the app spins.
 * Behind Nginx we read `x-forwarded-proto`; the cookie becomes `Secure`
 * automatically once the site is served over HTTPS.
 */
export function cookieSecure(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if (proto) return proto === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

const SECRET = new TextEncoder().encode(
  process.env.AUTH_JWT_SECRET ?? "dev-insecure-secret-change-me",
);

export type Role = "admin" | "member";

export interface Session {
  sub: string;
  email: string;
  name: string;
  role: Role;
}

/** Verify a session JWT. Returns null when missing/expired/tampered. */
export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (!payload.sub) return null;
    return {
      sub: String(payload.sub),
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      role: payload.role === "admin" ? "admin" : "member",
    };
  } catch {
    return null;
  }
}

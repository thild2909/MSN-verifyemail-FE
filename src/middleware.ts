/**
 * Route protection — the single gate in front of every page AND every /api route.
 *
 *   Pages:
 *     - unauthenticated  → redirect to /login (with ?next= to return afterwards)
 *     - authenticated at /login → redirect into the app
 *     - non-admin at an admin-only page → redirect to /settings
 *   API (/api/*):
 *     - deny by default: no valid session → 401 JSON (only login/logout are public)
 *     - admin-only endpoints (runtime secrets, proxy test, credit reset, users) → 403
 *     - state-changing requests from a foreign Origin → 403 (CSRF)
 *
 * Many /api/v1 routes are served from FE-local stores (Find Leads caches) and
 * never reach BE-service, so this gate must not rely on BE checks. BE-service
 * independently re-checks every request (defense in depth).
 *
 * Sessions are verified locally (JWT signature/expiry) and then confirmed with
 * BE-service `/auth/me` (cached briefly) so a revoked session or a deactivated /
 * demoted user loses access within SESSION_RECHECK_MS instead of at JWT expiry.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession, type Session } from "@/lib/auth";

const PUBLIC_PATHS = ["/login"];
const ADMIN_PATHS = ["/settings/team"];

const PUBLIC_API = new Set(["/api/v1/auth/login", "/api/v1/auth/logout"]);
/** Admin-only API: [path prefix, methods (empty = all)]. */
const ADMIN_API: [string, string[]][] = [
  ["/api/v1/settings", []],
  ["/api/v1/proxy/test", []],
  ["/api/v1/credits/reset", []],
  ["/api/v1/users", []],
  ["/api/v1/workspace", ["POST", "PUT", "PATCH", "DELETE"]],
];

const BE_URL = process.env.CRAWLER_SERVICE_URL ?? "http://localhost:8090";
const SESSION_RECHECK_MS = 30_000;

const under = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(base + "/");

/* ------------------------- server-side session check ------------------------ */

type Check = { session: Session | null; at: number };
const cache = new Map<string, Check>();

/**
 * Confirm the (signature-valid) token with BE-service: revoked session,
 * deactivated user or changed role → null / updated role. On a BE network
 * failure we keep the local verdict (signature + expiry still enforced); BE
 * itself rejects the token on every data call anyway.
 */
async function confirmSession(token: string, local: Session): Promise<Session | null> {
  const now = Date.now();
  const hit = cache.get(token);
  if (hit && now - hit.at < SESSION_RECHECK_MS) return hit.session;

  let session: Session | null = local;
  try {
    const res = await fetch(`${BE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 401 || res.status === 403) session = null;
    else if (res.ok) {
      const j = (await res.json().catch(() => null)) as { data?: { role?: string } } | null;
      if (j?.data?.role) session = { ...local, role: j.data.role === "admin" ? "admin" : "member" };
    }
  } catch {
    // BE unreachable — fall back to the local verdict, do not cache it long.
    return local;
  }
  if (cache.size > 2000) cache.clear();
  cache.set(token, { session, at: now });
  return session;
}

async function currentSession(req: NextRequest): Promise<Session | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const local = await verifySession(token);
  if (!local || !token) return null;
  return confirmSession(token, local);
}

/* --------------------------------- helpers --------------------------------- */

function publicHost(req: NextRequest): string | null {
  return req.headers.get("x-forwarded-host") ?? req.headers.get("host");
}

/**
 * Build a redirect URL that points at the host the client actually used.
 * Next.js runs behind Nginx bound to 127.0.0.1:3000, so rebuild the origin from
 * the forwarded headers instead of `req.nextUrl` (which would be localhost:3000).
 */
function redirectTo(req: NextRequest, pathname: string, params?: Record<string, string>): NextResponse {
  const url = req.nextUrl.clone();
  const host = publicHost(req);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if (host) {
    const [hostname, port = ""] = host.split(":");
    url.hostname = hostname;
    url.port = port;
  }
  if (proto) url.protocol = `${proto}:`;
  url.pathname = pathname;
  url.search = "";
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

function apiError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ success: false, error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The only API route that legitimately accepts a multipart upload. */
const MULTIPART_API = new Set(["/api/v1/leads/ai-report/parse-file"]);

/**
 * JSON-only API: a state-changing request that declares a non-JSON body
 * (form-urlencoded / multipart / text/plain — the content types an HTML form
 * can send cross-site without a CORS preflight) is refused with 415.
 */
function unsupportedBody(req: NextRequest, pathname: string): boolean {
  if (SAFE_METHODS.has(req.method)) return false;
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!ct) return false; // bodyless POST/DELETE
  if (MULTIPART_API.has(pathname)) return !ct.startsWith("multipart/form-data");
  return !ct.startsWith("application/json");
}

/** Reject cross-site state-changing API calls (Origin must match our host). */
function foreignOrigin(req: NextRequest): boolean {
  if (SAFE_METHODS.has(req.method)) return false;
  const origin = req.headers.get("origin");
  if (!origin) return false; // same-origin fetch from older browsers / server-side callers
  try {
    return new URL(origin).host !== publicHost(req);
  } catch {
    return true;
  }
}

/* -------------------------------- middleware -------------------------------- */

export async function middleware(req: NextRequest) {
  // This app defines no Server Actions, so a Next-Action header is only ever a
  // scanner probing for RSC deserialization bugs. Refuse it before Next parses it.
  if (req.headers.has("next-action")) return new NextResponse(null, { status: 403 });

  const { pathname } = req.nextUrl;

  /* ---------------------------------- API ---------------------------------- */
  if (under(pathname, "/api")) {
    if (foreignOrigin(req)) return apiError(403, "FORBIDDEN", "Cross-origin request refused.");
    if (unsupportedBody(req, pathname)) return apiError(415, "UNSUPPORTED_MEDIA_TYPE", "Send a JSON body (Content-Type: application/json).");
    if (PUBLIC_API.has(pathname)) return NextResponse.next();

    const session = await currentSession(req);
    if (!session) return apiError(401, "UNAUTHENTICATED", "Not authenticated.");

    const adminOnly = ADMIN_API.some(([p, methods]) => under(pathname, p) && (methods.length === 0 || methods.includes(req.method)));
    if (adminOnly && session.role !== "admin") return apiError(403, "FORBIDDEN", "Admin access required.");
    return NextResponse.next();
  }

  /* --------------------------------- pages --------------------------------- */
  const session = await currentSession(req);
  const isPublic = PUBLIC_PATHS.some((p) => under(pathname, p));

  if (!session) {
    if (isPublic) return NextResponse.next();
    return redirectTo(req, "/login", { next: pathname });
  }

  if (isPublic) {
    return redirectTo(req, "/verification");
  }

  if (session.role !== "admin" && ADMIN_PATHS.some((p) => under(pathname, p))) {
    return redirectTo(req, "/settings");
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Pages: everything except Next internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.[\\w]+$).*)",
    // API: EVERY path, including ones with a dot (a dynamic [id] like "x.csv"
    // must not slip past the gate via the static-file exclusion above).
    "/api/:path*",
    // Next parses a Next-Action header on any path, so those exclusions must not exempt it.
    { source: "/:path*", has: [{ type: "header", key: "next-action" }] },
  ],
};

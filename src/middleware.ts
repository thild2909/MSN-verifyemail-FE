/**
 * Route protection. Verifies the session cookie and gates page navigation:
 *   - unauthenticated  → redirect to /login (with ?next= to return afterwards)
 *   - authenticated at /login → redirect into the app
 *   - non-admin at an admin-only page → redirect to /settings
 *
 * Data routes under /api/* are excluded here; they verify the forwarded Bearer
 * token at BE-service. Static assets are excluded via the matcher.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

const PUBLIC_PATHS = ["/login"];
const ADMIN_PATHS = ["/settings/team"];

const under = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(base + "/");

/**
 * Build a redirect URL that points at the host the client actually used.
 *
 * Next.js runs behind Nginx bound to 127.0.0.1:3000, and `req.nextUrl` reflects
 * that internal bind address, so a naive `NextResponse.redirect(req.nextUrl…)`
 * sends the browser to `http://localhost:3000/…`. Rebuild the origin from the
 * forwarded headers (Nginx sets `Host` and `X-Forwarded-Proto`) so the redirect
 * stays on the real host/domain.
 */
function redirectTo(req: NextRequest, pathname: string, params?: Record<string, string>): NextResponse {
  const url = req.nextUrl.clone();
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if (host) {
    // `host` may be "hostname" or "hostname:port". Set both explicitly —
    // assigning `url.host` without a port would keep the internal :3000.
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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
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
  // Run on everything except Next internals, API routes, and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\\.[\\w]+$).*)"],
};

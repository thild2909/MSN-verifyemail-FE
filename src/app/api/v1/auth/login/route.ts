import { NextResponse } from "next/server";
import { be } from "@/server/verify-client";
import { SESSION_COOKIE, cookieSecure } from "@/lib/auth";
import type { AppUser } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, matches the JWT TTL

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "Malformed JSON." } }, { status: 400 });
  }

  // Forward the real browser device info so the session records it (this proxy
  // hop would otherwise present the Node server's UA / the proxy's IP to BE).
  const fwd: Record<string, string> = {};
  const ua = req.headers.get("user-agent");
  if (ua) fwd["user-agent"] = ua;
  // Client IP for BE's brute-force limiter. Nginx APPENDS the real peer address
  // to X-Forwarded-For, so the LAST entry is trustworthy; earlier entries are
  // client-controlled and would let an attacker rotate fake IPs.
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = hops[hops.length - 1];
  if (ip) fwd["x-forwarded-for"] = ip;

  const res = await be<{ data?: { token: string; user: AppUser }; error?: string; retryAfter?: number }>("/auth/login", {
    method: "POST",
    headers: fwd,
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.json.data) {
    if (res.status === 503) {
      return NextResponse.json(
        { success: false, error: { code: "BE_UNAVAILABLE", message: "Sign-in service is unavailable. Please make sure the backend is running and try again." } },
        { status: 503 },
      );
    }
    if (res.status === 429) {
      const wait = Number(res.json.retryAfter ?? 900);
      return NextResponse.json(
        { success: false, error: { code: "RATE_LIMITED", message: `Too many failed sign-in attempts. Try again in ${Math.ceil(wait / 60)} minute(s).` } },
        { status: 429, headers: { "Retry-After": String(wait) } },
      );
    }
    const message = res.status === 401 ? "Invalid email or password." : "Could not sign in. Please try again.";
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message } }, { status: res.status === 401 ? 401 : 502 });
  }

  const out = NextResponse.json({ success: true, data: res.json.data.user });
  out.cookies.set(SESSION_COOKIE, res.json.data.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(req),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return out;
}

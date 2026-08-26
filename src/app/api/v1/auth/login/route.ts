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
  const xff = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  if (xff) fwd["x-forwarded-for"] = xff;

  const res = await be<{ data?: { token: string; user: AppUser }; error?: string }>("/auth/login", {
    method: "POST",
    headers: fwd,
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.json.data) {
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

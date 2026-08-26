import { NextResponse } from "next/server";
import { be } from "@/server/verify-client";
import { sessionToken } from "@/server/session";
import { SESSION_COOKIE, cookieSecure } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Revoke the server-side session so it disappears from "Active sessions".
  const token = await sessionToken();
  if (token) {
    await be("/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({}) }).catch(() => {});
  }

  const out = NextResponse.json({ success: true });
  out.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(req),
    path: "/",
    maxAge: 0,
  });
  return out;
}

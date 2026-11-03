import { NextResponse } from "next/server";
import { be } from "@/server/verify-client";
import { sessionToken } from "@/server/session";
import type { AppUser } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauth = () =>
  NextResponse.json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated." } }, { status: 401 });

/** Self-service profile update: { name?, avatarUrl?, bannerUrl? } (images as data URLs, null clears). */
export async function PATCH(req: Request) {
  const token = await sessionToken();
  if (!token) return unauth();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "Malformed JSON." } }, { status: 400 });
  }
  const res = await be<{ data?: AppUser; error?: string }>("/auth/me", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (res.ok && res.json.data) return NextResponse.json({ success: true, data: res.json.data });
  if (res.status === 401) return unauth();
  if (res.status === 400) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: res.json.error ?? "Invalid request." } }, { status: 400 });
  }
  return NextResponse.json(
    { success: false, error: { code: res.status === 503 ? "BE_UNAVAILABLE" : "INTERNAL", message: "Could not update your profile." } },
    { status: res.status === 503 ? 503 : 502 },
  );
}

export async function GET() {
  const token = await sessionToken();
  if (!token) return unauth();
  const res = await be<{ data?: AppUser }>("/auth/me", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok || !res.json.data) return unauth();
  return NextResponse.json({ success: true, data: res.json.data });
}

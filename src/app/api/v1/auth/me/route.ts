import { NextResponse } from "next/server";
import { be } from "@/server/verify-client";
import { sessionToken } from "@/server/session";
import type { AppUser } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauth = () =>
  NextResponse.json({ success: false, error: { code: "UNAUTHENTICATED", message: "Not authenticated." } }, { status: 401 });

export async function GET() {
  const token = await sessionToken();
  if (!token) return unauth();
  const res = await be<{ data?: AppUser }>("/auth/me", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok || !res.json.data) return unauth();
  return NextResponse.json({ success: true, data: res.json.data });
}

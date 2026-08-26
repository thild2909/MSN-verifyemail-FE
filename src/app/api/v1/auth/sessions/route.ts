import { NextResponse } from "next/server";
import { be } from "@/server/verify-client";
import { sessionToken } from "@/server/session";
import type { DeviceSession } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const token = await sessionToken();
  if (!token) return NextResponse.json({ success: false, error: { code: "UNAUTHENTICATED", message: "Please sign in again." } }, { status: 401 });
  const res = await be<{ data?: DeviceSession[] }>("/auth/sessions", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok || !res.json.data) {
    return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not load sessions." } }, { status: res.status === 401 ? 401 : 502 });
  }
  return NextResponse.json({ success: true, data: res.json.data });
}

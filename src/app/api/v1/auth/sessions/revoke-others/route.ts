import { NextResponse } from "next/server";
import { be } from "@/server/verify-client";
import { sessionToken } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const token = await sessionToken();
  if (!token) return NextResponse.json({ success: false, error: { code: "UNAUTHENTICATED", message: "Please sign in again." } }, { status: 401 });

  const res = await be<{ data?: { revoked: number } }>("/auth/sessions/revoke-others", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  if (!res.ok || !res.json.data) {
    return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not revoke sessions." } }, { status: res.status === 401 ? 401 : 502 });
  }
  return NextResponse.json({ success: true, data: res.json.data });
}

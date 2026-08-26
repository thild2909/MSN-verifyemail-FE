import { NextResponse } from "next/server";
import { be } from "@/server/verify-client";
import { sessionToken } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await sessionToken();
  if (!token) return NextResponse.json({ success: false, error: { code: "UNAUTHENTICATED", message: "Please sign in again." } }, { status: 401 });

  const res = await be<{ data?: { id: string; current: boolean }; error?: string }>(
    `/auth/sessions/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.ok && res.json.data) return NextResponse.json({ success: true, data: res.json.data });
  if (res.status === 404) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Session not found." } }, { status: 404 });
  return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not revoke session." } }, { status: res.status === 401 ? 401 : 502 });
}

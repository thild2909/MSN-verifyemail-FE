import { NextResponse } from "next/server";
import { be } from "@/server/verify-client";
import { sessionToken } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Workspace { name: string; updatedAt: string | null }

function fail(status: number, message?: string) {
  const map: Record<number, { code: string; message: string }> = {
    400: { code: "INVALID_REQUEST", message: message ?? "Invalid request." },
    401: { code: "UNAUTHENTICATED", message: "Please sign in again." },
    403: { code: "FORBIDDEN", message: "Only admins can rename the workspace." },
  };
  const e = map[status] ?? { code: "INTERNAL", message: "Could not reach the workspace service." };
  return NextResponse.json({ success: false, error: e }, { status: status in map ? status : 502 });
}

export async function GET() {
  const token = await sessionToken();
  if (!token) return fail(401);
  const res = await be<{ data?: Workspace; error?: string }>("/workspace", { headers: { Authorization: `Bearer ${token}` } });
  if (res.ok && res.json.data) return NextResponse.json({ success: true, data: res.json.data });
  return fail(res.status, res.json.error);
}

/** Rename the workspace (admin only): { name } */
export async function PATCH(req: Request) {
  const token = await sessionToken();
  if (!token) return fail(401);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Malformed JSON.");
  }
  const res = await be<{ data?: Workspace; error?: string }>("/workspace", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (res.ok && res.json.data) return NextResponse.json({ success: true, data: res.json.data });
  return fail(res.status, res.json.error);
}

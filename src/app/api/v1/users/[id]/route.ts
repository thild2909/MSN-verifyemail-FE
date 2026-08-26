import { NextResponse } from "next/server";
import { be } from "@/server/verify-client";
import { authHeaders } from "@/server/session";
import type { AppUser } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, beError?: string) {
  const map: Record<number, { code: string; message: string }> = {
    400: { code: "INVALID_REQUEST", message: beError ?? "Invalid request." },
    401: { code: "UNAUTHENTICATED", message: "Please sign in again." },
    403: { code: "FORBIDDEN", message: "Admin access required." },
    404: { code: "NOT_FOUND", message: "User not found." },
    409: { code: "CONFLICT", message: beError ?? "A user with that email already exists." },
  };
  const e = map[status] ?? { code: "INTERNAL", message: "Something went wrong." };
  return NextResponse.json({ success: false, error: e }, { status: status in map ? status : 502 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Malformed JSON.");
  }
  const res = await be<{ data?: AppUser; error?: string }>(`/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (res.ok && res.json.data) return NextResponse.json({ success: true, data: res.json.data });
  return fail(res.status, res.json.error);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await be<{ data?: { id: string }; error?: string }>(`/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (res.ok && res.json.data) return NextResponse.json({ success: true, data: res.json.data });
  return fail(res.status, res.json.error);
}

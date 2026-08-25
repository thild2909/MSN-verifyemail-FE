import { NextResponse } from "next/server";
import { z } from "zod";
import { be } from "@/server/verify-client";
import type { LeadList } from "@/lib/api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound() {
  return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "List not found." } }, { status: 404 });
}

const patchSchema = z.object({ name: z.string().trim().min(1).max(120) });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "A `name` is required." } }, { status: 400 });
  }
  const res = await be<{ data: LeadList }>(`/leads/lists/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name: parsed.data.name }),
  });
  if (res.status === 404) return notFound();
  if (!res.ok) return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not rename list." } }, { status: 502 });
  return NextResponse.json({ success: true, data: res.json.data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await be(`/leads/lists/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (res.status === 404) return notFound();
  if (res.status === 400) return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "The Saved list cannot be deleted." } }, { status: 400 });
  if (!res.ok) return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not delete list." } }, { status: 502 });
  return NextResponse.json({ success: true, data: { id } });
}

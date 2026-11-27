import { NextResponse } from "next/server";
import { z } from "zod";
import { be, beError } from "@/server/verify-client";
import type { EmailList } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound() {
  return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "List not found." } }, { status: 404 });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await be<{ data: EmailList }>(`/lists/${encodeURIComponent(id)}`);
  if (res.status === 404) return notFound();
  if (!res.ok) return beError(res, "Could not load list.");
  return NextResponse.json({ success: true, data: res.json.data });
}

const patchSchema = z.object({ name: z.string().trim().min(1).max(120) });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "A `name` is required." } }, { status: 400 });
  }
  const res = await be<{ data: EmailList }>(`/lists/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name: parsed.data.name }),
  });
  if (res.status === 404) return notFound();
  if (!res.ok) return beError(res, "Could not rename list.");
  return NextResponse.json({ success: true, data: res.json.data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await be(`/lists/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (res.status === 404) return notFound();
  if (!res.ok) return beError(res, "Could not delete list.");
  return NextResponse.json({ success: true, data: { id } });
}

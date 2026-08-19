import { NextResponse } from "next/server";
import { z } from "zod";
import * as store from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const list = store.getList(id);
  if (!list) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "List not found." } }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: list });
}

const patchSchema = z.object({ name: z.string().trim().min(1).max(120) });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "A `name` is required." } }, { status: 400 });
  }
  const list = store.renameList(id, parsed.data.name);
  if (!list) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "List not found." } }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: list });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.deleteList(id)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "List not found." } }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: { id } });
}

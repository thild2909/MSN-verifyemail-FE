import { NextResponse } from "next/server";
import { z } from "zod";
import * as store from "@/server/enrich-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const table = store.getEnrichTable(id);
  if (!table) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Enrichment table not found." } }, { status: 404 });
  return NextResponse.json({ success: true, data: table });
}

const patchSchema = z.object({ name: z.string().trim().min(1).max(120) });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "A `name` is required." } }, { status: 400 });
  const table = store.renameEnrichTable(id, parsed.data.name);
  if (!table) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Enrichment table not found." } }, { status: 404 });
  return NextResponse.json({ success: true, data: table });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.deleteEnrichTable(id)) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Enrichment table not found." } }, { status: 404 });
  return NextResponse.json({ success: true, data: { id } });
}

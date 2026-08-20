import { NextResponse } from "next/server";
import { z } from "zod";
import * as store from "@/server/enrich-store";
import { startEnrichJob } from "@/server/enrich-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addSchema = z.object({
  kind: z.enum([
    "find_work_email", "verify_email", "find_phone", "find_linkedin",
    "enrich_company", "company_tech", "generic_emails", "ai_research",
  ]),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "A valid `kind` is required." } }, { status: 400 });
  try {
    const table = store.addColumn(id, parsed.data.kind);
    startEnrichJob(id);
    return NextResponse.json({ success: true, data: table }, { status: 201 });
  } catch (err) {
    if (err instanceof store.CreditsError) {
      return NextResponse.json({ success: false, error: { code: err.code, message: err.message, required: err.required, available: err.available } }, { status: 402 });
    }
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Enrichment table not found." } }, { status: 404 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const colId = new URL(req.url).searchParams.get("colId");
  if (!colId) return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "A `colId` is required." } }, { status: 400 });
  const table = store.removeColumn(id, colId);
  if (!table) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Enrichment table not found." } }, { status: 404 });
  return NextResponse.json({ success: true, data: table });
}

import { NextResponse } from "next/server";
import * as store from "@/server/enrich-store";
import { startEnrichJob } from "@/server/enrich-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-run every cell in the table (charges credits). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const table = store.rerunEnrichTable(id);
    startEnrichJob(id);
    return NextResponse.json({ success: true, data: table });
  } catch (err) {
    if (err instanceof store.CreditsError) {
      return NextResponse.json({ success: false, error: { code: err.code, message: err.message, required: err.required, available: err.available } }, { status: 402 });
    }
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Enrichment table not found." } }, { status: 404 });
  }
}

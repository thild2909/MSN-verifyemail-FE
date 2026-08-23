import { NextResponse } from "next/server";
import * as store from "@/server/company-collect-store";
import { startCollectJob } from "@/server/company-collect-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-run collection for rows that failed (proxy/search timeout recovery). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getCollectJob(id)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Collection job not found." } }, { status: 404 });
  }
  const reset = store.resetFailedCompanies(id);
  if (reset) startCollectJob(id);
  return NextResponse.json({ success: true, data: { reset, started: reset > 0 } });
}

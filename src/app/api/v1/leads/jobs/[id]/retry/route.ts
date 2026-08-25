import { NextResponse } from "next/server";
import * as store from "@/server/job-collect-store";
import { startJobSearch, isJobSearchRunning } from "@/server/job-collect-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-crawl only the blocked/failed sources of an existing job search. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = store.getJobSearch(id);
  if (!job) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Job search not found." } }, { status: 404 });
  if (isJobSearchRunning(id)) return NextResponse.json({ success: false, error: { code: "BUSY", message: "This crawl is already running." } }, { status: 409 });

  const sources = store.retryBlockedSources(id);
  if (sources.length === 0) return NextResponse.json({ success: false, error: { code: "NOTHING_TO_RETRY", message: "No blocked or failed sources to retry." } }, { status: 400 });

  startJobSearch(id);
  return NextResponse.json({ success: true, data: { id, sources } });
}

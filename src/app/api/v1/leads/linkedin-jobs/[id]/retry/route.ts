import { NextResponse } from "next/server";
import * as store from "@/server/linkedin-jobs-collect-store";
import { startLinkedInSearch, isLinkedInSearchRunning } from "@/server/linkedin-jobs-collect-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-crawl only the blocked/failed queries of an existing scrape. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getLinkedInSearch(id)) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Scrape not found." } }, { status: 404 });
  if (isLinkedInSearchRunning(id)) return NextResponse.json({ success: false, error: { code: "BUSY", message: "This scrape is already running." } }, { status: 409 });
  const queries = store.retryBlockedQueries(id);
  if (queries.length === 0) return NextResponse.json({ success: false, error: { code: "NOTHING_TO_RETRY", message: "No blocked or failed queries to retry." } }, { status: 400 });
  startLinkedInSearch(id);
  return NextResponse.json({ success: true, data: { id, queries } });
}

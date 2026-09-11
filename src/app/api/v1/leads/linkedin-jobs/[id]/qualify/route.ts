import { NextResponse } from "next/server";
import * as store from "@/server/linkedin-jobs-collect-store";
import { startLinkedInEnrich, isLinkedInEnriching } from "@/server/linkedin-jobs-collect-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Opt-in "Qualify companies": fetch job detail + scrape company pages for the
 *  qualified roles, then re-qualify/re-score. Runs in the background. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getLinkedInSearch(id)) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Scrape not found." } }, { status: 404 });
  if (isLinkedInEnriching(id)) return NextResponse.json({ success: false, error: { code: "BUSY", message: "Qualification is already running." } }, { status: 409 });
  const targets = store.enrichTargets(id).length;
  if (targets === 0) return NextResponse.json({ success: false, error: { code: "NOTHING_TO_ENRICH", message: "No qualified roles left to enrich." } }, { status: 400 });
  startLinkedInEnrich(id);
  return NextResponse.json({ success: true, data: { id, targets } });
}

import { NextResponse } from "next/server";
import * as store from "@/server/people-collect-store";
import { startPeopleJob } from "@/server/people-collect-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Retry failed" (People tab) — re-crawl the coverage-gap companies (0 people found). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getPeopleJob(id)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "People job not found." } }, { status: 404 });
  }
  const reset = store.resetGapSeeds(id);
  if (reset) startPeopleJob(id);
  return NextResponse.json({ success: true, data: { reset, started: reset > 0 } });
}

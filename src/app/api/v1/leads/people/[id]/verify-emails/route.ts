import { NextResponse } from "next/server";
import * as store from "@/server/people-collect-store";
import { verifyCollectedPeople } from "@/server/people-verify";
import { clearVerifyCache } from "@/server/verification";
import { clearDomainCache } from "@/server/finder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Find & verify" — incremental by default: keep saved verdicts (including
 * Not found) and only look up people not yet checked. Pass `fresh=1` to wipe
 * caches + prior results and re-search everyone.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getPeopleJob(id)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "People job not found." } }, { status: 404 });
  }
  const q = new URL(req.url).searchParams;
  const fresh = q.get("fresh") === "1" || q.get("keep") === "0";

  if (fresh) {
    clearVerifyCache();
    clearDomainCache();
    store.resetPeopleVerification(id);
  }

  const result = await verifyCollectedPeople(id, true);
  return NextResponse.json({ success: true, data: result });
}

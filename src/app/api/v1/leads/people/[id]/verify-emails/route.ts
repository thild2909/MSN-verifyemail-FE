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
 * caches + ALL prior results and re-search everyone. Pass `notfound=1` ("Retry
 * notfound") to re-open only the misses (verdict Not found) and re-search just
 * those, keeping every settled address.
 *
 * The pass runs in the BACKGROUND: a full job (hundreds/thousands of people,
 * each doing several SMTP lookups) far exceeds the proxy's request timeout, so
 * we mark the job "verifying", kick the pass off without awaiting, and return
 * immediately. The People tab polls the job's verifyStatus and shows live
 * per-row progress, then re-enables when the pass flips to "done".
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = store.getPeopleJob(id);
  if (!job) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "People job not found." } }, { status: 404 });
  }
  const q = new URL(req.url).searchParams;
  const fresh = q.get("fresh") === "1" || q.get("keep") === "0";
  const notfound = q.get("notfound") === "1";

  // A pass is already running — don't start a second, racing one.
  if (job.verifyStatus === "verifying") {
    return NextResponse.json({ success: true, data: { started: false, alreadyRunning: true, pending: store.peopleVerifyTargets(id, true).length } });
  }

  if (fresh) {
    clearVerifyCache();
    clearDomainCache();
    store.resetPeopleVerification(id);
  } else if (notfound) {
    // Retry only the misses: drop cached verdicts/domains so the finder actually
    // re-searches (rather than replaying the same Not found), then re-open the
    // not_found rows. Settled addresses are left as-is.
    clearVerifyCache();
    clearDomainCache();
    store.resetPeopleNotFound(id);
  }

  const pending = store.peopleVerifyTargets(id, true).length;
  // Mark verifying up front so the polling UI shows progress immediately.
  store.setJobVerifyStatus(id, "verifying");
  // Fire-and-forget: the pass persists after every person and sets the job to
  // "done" when finished. On a hard failure, drop back to "idle" so it can be
  // retried. (verifyCollectedPeople already resets to idle on engine outage.)
  void verifyCollectedPeople(id, true).catch((err) => {
    store.setJobVerifyStatus(id, "idle");
    console.error(`[verify-emails] background pass failed for ${id}:`, err);
  });

  return NextResponse.json({ success: true, data: { started: true, pending } });
}

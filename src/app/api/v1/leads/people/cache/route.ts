import { NextResponse } from "next/server";
import { resetPeopleVerification } from "@/server/people-collect-store";
import { clearVerifyCache } from "@/server/verification";
import { clearDomainCache } from "@/server/finder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dev utility: clear the People email caches so "Find & verify" re-runs clean —
 * resets every person's stored verdict AND wipes the in-memory email-verify +
 * finder-domain caches so the next pass does fresh backend lookups. Pass
 * ?job=<id> to scope the verdict reset to one crawl (caches are global).
 */
function clear(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Not available in production." } }, { status: 403 });
  }
  const jobId = new URL(req.url).searchParams.get("job") ?? undefined;
  const people = resetPeopleVerification(jobId);
  const emails = clearVerifyCache();
  const domains = clearDomainCache();
  return NextResponse.json({ success: true, cleared: { people, emails, domains } });
}

export async function DELETE(req: Request) {
  return clear(req);
}

export async function POST(req: Request) {
  return clear(req);
}

import { NextResponse } from "next/server";
import { clearDomainCache } from "@/server/finder";
import { clearVerifyCache } from "@/server/verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dev utility: wipe the finder's in-memory caches so a re-test starts clean. */
function clear() {
  // Guard against clearing caches in a production deployment.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ success: false, error: { code: "FORBIDDEN", message: "Not available in production." } }, { status: 403 });
  }
  const emails = clearVerifyCache();
  const domains = clearDomainCache();
  return NextResponse.json({ success: true, cleared: { emails, domains } });
}

export async function DELETE() {
  return clear();
}

export async function POST() {
  return clear();
}

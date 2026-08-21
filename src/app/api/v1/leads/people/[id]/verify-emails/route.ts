import { NextResponse } from "next/server";
import * as store from "@/server/people-collect-store";
import { verifyCollectedPeople } from "@/server/people-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verify the collected people's emails (pattern-guessed or found) through the
 * verification backend. `all=1` re-checks every email; otherwise only unverified.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getPeopleJob(id)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "People job not found." } }, { status: 404 });
  }
  const all = new URL(req.url).searchParams.get("all") === "1";
  const result = await verifyCollectedPeople(id, !all);
  return NextResponse.json({ success: true, data: result });
}

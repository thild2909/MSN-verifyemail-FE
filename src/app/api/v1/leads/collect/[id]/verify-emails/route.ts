import { NextResponse } from "next/server";
import * as store from "@/server/company-collect-store";
import { verifyCollectedEmails } from "@/server/company-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verify the collected companies' real contact emails through the verification
 * backend. Body/query `all=1` re-checks every email; otherwise only the ones
 * not yet verified.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getCollectJob(id)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Collection job not found." } }, { status: 404 });
  }
  const all = new URL(req.url).searchParams.get("all") === "1";
  const result = await verifyCollectedEmails(id, !all);
  return NextResponse.json({ success: true, data: result });
}

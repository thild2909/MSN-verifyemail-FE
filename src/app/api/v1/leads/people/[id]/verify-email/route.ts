import { NextResponse } from "next/server";
import * as store from "@/server/people-collect-store";
import { verifyOnePersonEmail } from "@/server/people-verify";
import { VerifierUnavailableError } from "@/lib/verifier/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-row "Access email" — find + verify a SINGLE person's email on demand.
 * Body: { personId }. Bulk "Find & verify" stays on /verify-emails.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getPeopleJob(id)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "People job not found." } }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { personId?: string };
  const personId = body.personId?.trim();
  if (!personId) {
    return NextResponse.json({ success: false, error: { code: "BAD_REQUEST", message: "personId required." } }, { status: 400 });
  }
  try {
    const result = await verifyOnePersonEmail(id, personId);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof VerifierUnavailableError) {
      return NextResponse.json(
        { success: false, error: { code: "VERIFIER_UNAVAILABLE", message: "Verification engine unavailable — not checked. Please try again." } },
        { status: 503 },
      );
    }
    throw err;
  }
}

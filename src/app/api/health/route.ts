import { NextResponse } from "next/server";
import { pingBackend } from "@/lib/verifier/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Signed-in only (enforced by middleware). Never echo internal URLs / errors.
export async function GET() {
  const status = await pingBackend();
  return NextResponse.json({ online: status.online }, { status: status.online ? 200 : 503 });
}

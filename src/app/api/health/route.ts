import { NextResponse } from "next/server";
import { pingBackend } from "@/lib/verifier/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await pingBackend();
  return NextResponse.json(status, { status: status.online ? 200 : 503 });
}

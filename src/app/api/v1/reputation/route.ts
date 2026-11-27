import { NextResponse } from "next/server";
import { be, beError } from "@/server/verify-client";
import type { ReputationStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current sending-IP reputation status (cached in BE-service). */
export async function GET() {
  const res = await be<ReputationStatus>("/reputation");
  if (!res.ok) return beError(res, "Reputation check unavailable.");
  return NextResponse.json({ success: true, data: res.json });
}

/** Force a fresh reputation check. */
export async function POST() {
  const res = await be<ReputationStatus>("/reputation/refresh", { method: "POST" });
  if (!res.ok) return beError(res, "Reputation check failed.");
  return NextResponse.json({ success: true, data: res.json });
}

import { NextResponse } from "next/server";
import { be, beError } from "@/server/verify-client";
import type { CreditTransaction } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const res = await be<{ data: CreditTransaction[] }>("/credits/transactions");
  if (!res.ok) return beError(res, "Could not load transactions.");
  return NextResponse.json({ success: true, data: res.json.data });
}

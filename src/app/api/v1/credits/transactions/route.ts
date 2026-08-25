import { NextResponse } from "next/server";
import { be } from "@/server/verify-client";
import type { CreditTransaction } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const res = await be<{ data: CreditTransaction[] }>("/credits/transactions");
  if (!res.ok) return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not load transactions." } }, { status: 502 });
  return NextResponse.json({ success: true, data: res.json.data });
}

import { NextResponse } from "next/server";
import { be, beError } from "@/server/verify-client";
import type { CreditBalance } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = await be<{ data: CreditBalance }>("/credits/reset", { method: "POST" });
  if (!res.ok) return beError(res, "Could not reset credits.");
  return NextResponse.json({ success: true, data: res.json.data });
}

import { NextResponse } from "next/server";
import { be, beError } from "@/server/verify-client";
import type { CreditBalance } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const res = await be<{ data: CreditBalance }>("/credits");
  if (!res.ok) return beError(res, "Could not load credits.");
  return NextResponse.json({ success: true, data: res.json.data });
}

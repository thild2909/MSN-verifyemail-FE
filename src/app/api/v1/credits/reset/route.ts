import { NextResponse } from "next/server";
import { be } from "@/server/verify-client";
import type { CreditBalance } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = await be<{ data: CreditBalance }>("/credits/reset", { method: "POST" });
  if (!res.ok) return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not reset credits." } }, { status: 502 });
  return NextResponse.json({ success: true, data: res.json.data });
}

import { NextResponse } from "next/server";
import * as store from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ success: true, data: store.getCredits() });
}

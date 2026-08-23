import { NextResponse } from "next/server";
import { getProxyTestStatusRemote } from "@/server/crawler-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ success: true, data: await getProxyTestStatusRemote() });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: "CRAWLER_UNAVAILABLE", message: `Crawler service unreachable: ${err instanceof Error ? err.message : "unknown"}` } },
      { status: 502 },
    );
  }
}

import { NextResponse } from "next/server";
import { testProxyRemote } from "@/server/crawler-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Proxy pool health check — proxied to the crawler service. */
export async function POST() {
  try {
    return NextResponse.json({ success: true, data: await testProxyRemote() });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: "CRAWLER_UNAVAILABLE", message: `Crawler service unreachable: ${err instanceof Error ? err.message : "unknown"}` } },
      { status: 502 },
    );
  }
}

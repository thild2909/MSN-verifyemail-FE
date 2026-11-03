import { NextResponse } from "next/server";
import { be } from "@/server/verify-client";
import type { AnalyticsReport } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANGES = new Set(["7", "30", "90"]);

/** Proxy to BE-service GET /analytics (aggregated from verification records + credit ledger). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = RANGES.has(url.searchParams.get("days") ?? "") ? url.searchParams.get("days")! : "30";
  const tz = (url.searchParams.get("tz") ?? "UTC").slice(0, 64);

  const res = await be<{ data?: AnalyticsReport }>(`/analytics?days=${days}&tz=${encodeURIComponent(tz)}`);
  if (!res.ok || !res.json.data) {
    const unavailable = res.status === 503;
    return NextResponse.json(
      {
        success: false,
        error: {
          code: unavailable ? "BE_UNAVAILABLE" : "INTERNAL",
          message: unavailable ? "Analytics service is unavailable." : "Could not load analytics.",
        },
      },
      { status: unavailable ? 503 : 502 },
    );
  }
  return NextResponse.json({ success: true, data: res.json.data });
}

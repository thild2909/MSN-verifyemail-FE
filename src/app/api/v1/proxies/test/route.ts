import { NextResponse } from "next/server";
import { z } from "zod";
import { testProxiesRemote } from "@/server/crawler-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ id: z.string().optional() });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  const id = parsed.success ? parsed.data.id : undefined;
  try {
    return NextResponse.json({ success: true, data: await testProxiesRemote(id) });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: "CRAWLER_UNAVAILABLE", message: `Crawler service unreachable: ${err instanceof Error ? err.message : "unknown"}` } },
      { status: 502 },
    );
  }
}

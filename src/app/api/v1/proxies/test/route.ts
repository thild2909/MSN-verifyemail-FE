import { NextResponse } from "next/server";
import { z } from "zod";
import * as store from "@/server/proxy-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ id: z.string().optional() });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  const id = parsed.success ? parsed.data.id : undefined;
  return NextResponse.json({ success: true, data: await store.testProxies(id) });
}

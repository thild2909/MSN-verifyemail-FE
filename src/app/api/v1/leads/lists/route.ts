import { NextResponse } from "next/server";
import { z } from "zod";
import { be } from "@/server/verify-client";
import type { LeadList } from "@/lib/api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const res = await be<{ data: LeadList[] }>("/leads/lists");
  if (!res.ok) return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not load lists." } }, { status: 502 });
  return NextResponse.json({ success: true, data: res.json.data });
}

const createSchema = z.object({ name: z.string().trim().min(1).max(120) });

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "A `name` is required." } }, { status: 400 });
  }
  const res = await be<{ data: LeadList }>("/leads/lists", {
    method: "POST",
    body: JSON.stringify({ name: parsed.data.name }),
  });
  if (!res.ok) return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not create list." } }, { status: 502 });
  return NextResponse.json({ success: true, data: res.json.data }, { status: 201 });
}

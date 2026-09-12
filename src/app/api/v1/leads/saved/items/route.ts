import { NextResponse } from "next/server";
import { z } from "zod";
import { be } from "@/server/verify-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const aiReportSchema = z.object({
  model: z.string().optional(),
  generatedAt: z.string().optional(),
  values: z.record(z.string()).default({}),
  labels: z.record(z.string()).optional(),
});
const leadItemSchema = z.object({
  kind: z.enum(["person", "company"]),
  refId: z.string().trim().min(1),
  jobId: z.string().nullish(),
  name: z.string().nullish(),
  company: z.string().nullish(),
  title: z.string().nullish(),
  email: z.string().nullish(),
  data: z.record(z.unknown()).default({}),
  aiReport: aiReportSchema.nullish(),
});
const addSchema = z.object({ items: z.array(leadItemSchema).min(1).max(1000) });

/** The Find Leads "Save" button — drops the selection into the built-in Saved list. */
export async function POST(req: Request) {
  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "An `items` array is required." } }, { status: 400 });
  }
  const res = await be<{ data: { added: number; skipped: number } }>("/leads/saved/items", {
    method: "POST",
    body: JSON.stringify({ items: parsed.data.items }),
  });
  if (!res.ok) return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not save items." } }, { status: 502 });
  return NextResponse.json({ success: true, data: res.json.data });
}

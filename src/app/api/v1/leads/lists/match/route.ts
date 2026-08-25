import { NextResponse } from "next/server";
import { z } from "zod";
import { be } from "@/server/verify-client";
import type { LeadMatchResult } from "@/lib/api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const matchSchema = z.object({
  people: z
    .array(z.object({ key: z.string().min(1), name: z.string().nullish(), company: z.string().nullish(), email: z.string().nullish() }))
    .max(100000)
    .optional(),
  companies: z
    .array(z.object({ key: z.string().min(1), company: z.string().nullish(), location: z.string().nullish() }))
    .max(100000)
    .optional(),
});

/** Match import rows against every saved list (people by email/name+company, companies by name+location). */
export async function POST(req: Request) {
  const parsed = matchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "A `people` or `companies` array is required." } }, { status: 400 });
  }
  const res = await be<{ data: LeadMatchResult }>("/leads/match", {
    method: "POST",
    body: JSON.stringify(parsed.data),
  });
  if (!res.ok) return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not match against lists." } }, { status: 502 });
  return NextResponse.json({ success: true, data: res.json.data });
}

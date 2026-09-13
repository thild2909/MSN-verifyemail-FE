import { NextResponse } from "next/server";
import { z } from "zod";
import { findEmailLayered } from "@/server/people-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  firstName: z.string().trim().min(1).max(100),
  // Optional: a single-token full name (e.g. "Madonna") has no last name. The
  // layered pipeline re-derives the split from `name` when it needs one.
  lastName: z.string().trim().max(100).optional().default(""),
  domain: z.string().trim().min(1).max(255),
  // Optional context — when present, unlocks the richer layers (L2/L3/L5).
  name: z.string().trim().max(200).optional(),
  company: z.string().trim().max(200).nullish(),
  title: z.string().trim().max(200).nullish(),
  linkedin: z.string().trim().max(400).nullish(),
  country: z.string().trim().max(120).nullish(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "Malformed JSON body.", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("INVALID_REQUEST", "`firstName`, `lastName` and `domain` are required.", 400);
  }

  const outcome = await findEmailLayered(parsed.data);
  return NextResponse.json({ success: true, data: outcome });
}

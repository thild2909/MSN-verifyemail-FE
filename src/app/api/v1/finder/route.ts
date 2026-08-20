import { NextResponse } from "next/server";
import { z } from "zod";
import { findPersonEmail } from "@/server/finder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  domain: z.string().trim().min(1).max(255),
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

  const outcome = await findPersonEmail(parsed.data);
  return NextResponse.json({ success: true, data: outcome });
}

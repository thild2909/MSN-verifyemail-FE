import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyWithBackend } from "@/lib/verifier/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Accept any non-empty candidate so the backend can classify bad syntax
// as "invalid" rather than the proxy rejecting it outright.
const schema = z.object({ email: z.string().trim().min(1).max(320) });

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
    return errorResponse("INVALID_REQUEST", "An `email` field is required.", 400);
  }

  const outcome = await verifyWithBackend(parsed.data.email);
  return NextResponse.json({
    success: true,
    data: outcome.result,
    provider: outcome.provider,
    ...(outcome.error ? { warning: outcome.error } : {}),
  });
}

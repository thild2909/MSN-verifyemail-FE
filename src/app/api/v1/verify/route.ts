import { NextResponse } from "next/server";
import { z } from "zod";
import { be } from "@/server/verify-client";
import type { VerificationResult } from "@/lib/types";

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

  const res = await be<{ result: VerificationResult; provider: string; warning?: string }>("/verify/email", {
    method: "POST",
    body: JSON.stringify({ email: parsed.data.email }),
  });
  if (!res.ok) return errorResponse("INTERNAL", "Verification failed.", 502);

  return NextResponse.json({
    success: true,
    data: res.json.result,
    provider: res.json.provider,
    ...(res.json.warning ? { warning: res.json.warning } : {}),
  });
}

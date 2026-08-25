import { NextResponse } from "next/server";
import { z } from "zod";
import { be } from "@/server/verify-client";
import type { VerificationResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ recordId: z.string().min(1) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "recordId is required." } }, { status: 400 });
  }

  const res = await be<{ data: VerificationResult }>(`/lists/${encodeURIComponent(id)}/deep-scan`, {
    method: "POST",
    body: JSON.stringify({ recordId: parsed.data.recordId }),
  });
  if (res.status === 404) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "List or record not found." } }, { status: 404 });
  }
  if (!res.ok) return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Deep scan failed." } }, { status: 502 });
  return NextResponse.json({ success: true, data: res.json.data });
}

import { NextResponse } from "next/server";
import { be } from "@/server/verify-client";
import type { EmailList } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await be<{ data: EmailList; error?: { code: string; message: string; required?: number; available?: number } }>(
    `/lists/${encodeURIComponent(id)}/reprocess`,
    { method: "POST" },
  );

  if (res.ok) return NextResponse.json({ success: true, data: res.json.data });
  if (res.status === 404) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "List not found." } }, { status: 404 });
  }
  if (res.status === 402 && res.json.error) {
    const e = res.json.error;
    return NextResponse.json(
      { success: false, error: { code: e.code, message: e.message, required: e.required, available: e.available } },
      { status: 402 },
    );
  }
  return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not reprocess list." } }, { status: 500 });
}

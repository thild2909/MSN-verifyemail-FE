import { NextResponse } from "next/server";
import { z } from "zod";
import * as store from "@/server/store";
import { verifyWithBackend } from "@/lib/verifier/backend";
import { CREDIT_COSTS } from "@/lib/credit-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ recordId: z.string().min(1) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getList(id)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "List not found." } }, { status: 404 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "recordId is required." } }, { status: 400 });
  }

  const record = store.rawRecords(id).find((r) => r.id === parsed.data.recordId);
  if (!record) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Record not found." } }, { status: 404 });
  }

  const { result } = await verifyWithBackend(record.email);
  store.applyResult(id, record.id, result);
  store.charge(CREDIT_COSTS.deep_scan, "deep_scan", `Deep scan — ${record.email}`);

  return NextResponse.json({ success: true, data: result });
}

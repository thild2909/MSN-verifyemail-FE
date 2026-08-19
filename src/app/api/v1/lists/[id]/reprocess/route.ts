import { NextResponse } from "next/server";
import * as store from "@/server/store";
import { startJob } from "@/server/verification-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getList(id)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "List not found." } }, { status: 404 });
  }
  try {
    const list = store.reprocessList(id);
    startJob(id);
    return NextResponse.json({ success: true, data: list });
  } catch (err) {
    if (err instanceof store.CreditsError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message, required: err.required, available: err.available } },
        { status: 402 },
      );
    }
    return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not reprocess list." } }, { status: 500 });
  }
}

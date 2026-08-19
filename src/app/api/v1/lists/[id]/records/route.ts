import { NextResponse } from "next/server";
import * as store from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getList(id)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "List not found." } }, { status: 404 });
  }

  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? 1);
  const pageSize = Number(url.searchParams.get("pageSize") ?? 12);
  const search = url.searchParams.get("search") ?? "";
  const status = url.searchParams.get("status") ?? "all";

  const result = store.getRecords(id, { page, pageSize, search, status });
  return NextResponse.json({ success: true, data: result });
}

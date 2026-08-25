import { NextResponse } from "next/server";
import { be } from "@/server/verify-client";
import type { EmailRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RecordsPage {
  records: EmailRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const qs = new URLSearchParams({
    page: url.searchParams.get("page") ?? "1",
    pageSize: url.searchParams.get("pageSize") ?? "12",
    search: url.searchParams.get("search") ?? "",
    status: url.searchParams.get("status") ?? "all",
  }).toString();

  const res = await be<{ data: RecordsPage }>(`/lists/${encodeURIComponent(id)}/records?${qs}`);
  if (res.status === 404) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "List not found." } }, { status: 404 });
  }
  if (!res.ok) return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not load records." } }, { status: 502 });
  return NextResponse.json({ success: true, data: res.json.data });
}

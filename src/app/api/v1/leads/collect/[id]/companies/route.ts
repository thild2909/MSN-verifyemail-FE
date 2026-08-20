import { NextResponse } from "next/server";
import * as store from "@/server/company-collect-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getCollectJob(id)) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Collection job not found." } }, { status: 404 });
  const url = new URL(req.url);
  const num = (k: string) => { const v = Number(url.searchParams.get(k)); return Number.isFinite(v) && v > 0 ? v : undefined; };
  const data = store.getCompanies(id, {
    page: num("page"),
    pageSize: num("pageSize"),
    search: url.searchParams.get("search") ?? "",
    filter: url.searchParams.get("filter") ?? "all",
  });
  return NextResponse.json({ success: true, data });
}

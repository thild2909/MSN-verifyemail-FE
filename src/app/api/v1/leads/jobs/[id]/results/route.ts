import { NextResponse } from "next/server";
import * as store from "@/server/job-collect-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getJobSearch(id)) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Job search not found." } }, { status: 404 });
  const url = new URL(req.url);
  const num = (k: string) => { const v = Number(url.searchParams.get(k)); return Number.isFinite(v) && v > 0 ? v : undefined; };
  const list = (k: string) => (url.searchParams.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const data = store.getJobs(id, {
    page: num("page"),
    pageSize: num("pageSize"),
    search: url.searchParams.get("search") ?? "",
    sources: list("sources"),
    companies: list("companies"),
    locations: list("locations"),
    workModes: list("workModes"),
    postedWithinDays: num("postedWithinDays"),
  });
  return NextResponse.json({ success: true, data });
}

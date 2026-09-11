import { NextResponse } from "next/server";
import * as store from "@/server/linkedin-jobs-collect-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getLinkedInSearch(id)) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Scrape not found." } }, { status: 404 });
  const url = new URL(req.url);
  const num = (k: string) => { const v = Number(url.searchParams.get(k)); return Number.isFinite(v) && v > 0 ? v : undefined; };
  const list = (k: string) => (url.searchParams.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const bool = (k: string) => url.searchParams.get(k) === "1" || url.searchParams.get(k) === "true";
  const data = store.getLinkedInJobs(id, {
    page: num("page"),
    pageSize: num("pageSize"),
    search: url.searchParams.get("search") ?? "",
    roleFamilies: list("roleFamilies"),
    countries: list("countries"),
    seniorities: list("seniorities"),
    remoteOnly: bool("remoteOnly"),
    qualifiedOnly: bool("qualifiedOnly"),
    minScore: num("minScore"),
    postedWithinDays: num("postedWithinDays"),
  });
  return NextResponse.json({ success: true, data });
}

import { NextResponse } from "next/server";
import * as store from "@/server/company-collect-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = store.getCollectJob(id);
  if (!job) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Collection job not found." } }, { status: 404 });
  const url = new URL(req.url);
  const num = (k: string) => { const v = Number(url.searchParams.get(k)); return Number.isFinite(v) && v > 0 ? v : undefined; };
  const list = (k: string) => (url.searchParams.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const data = store.getCompanies(id, {
    page: num("page"),
    pageSize: num("pageSize"),
    search: url.searchParams.get("search") ?? "",
    company: list("company"),
    locations: list("locations"),
    employees: list("employees"),
    industries: list("industries"),
    technologies: list("technologies"),
    status: list("status"),
    has: list("has"),
    email: list("email"),
  });
  return NextResponse.json({ success: true, data });
}

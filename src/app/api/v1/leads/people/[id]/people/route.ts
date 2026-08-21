import { NextResponse } from "next/server";
import * as store from "@/server/people-collect-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getPeopleJob(id)) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "People job not found." } }, { status: 404 });
  const url = new URL(req.url);
  const num = (k: string) => { const v = Number(url.searchParams.get(k)); return Number.isFinite(v) && v > 0 ? v : undefined; };
  const list = (k: string) => (url.searchParams.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const data = store.getPeople(id, {
    page: num("page"),
    pageSize: num("pageSize"),
    search: url.searchParams.get("search") ?? "",
    seniority: list("seniority"),
    email: list("email"),
    linkedin: url.searchParams.get("linkedin") === "1",
    companies: list("companies"),
  });
  return NextResponse.json({ success: true, data });
}

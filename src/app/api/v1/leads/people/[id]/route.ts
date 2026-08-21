import { NextResponse } from "next/server";
import * as store from "@/server/people-collect-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = store.getPeopleJob(id);
  if (!job) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "People job not found." } }, { status: 404 });
  return NextResponse.json({ success: true, data: { ...job, coverage: store.getSeedCoverage(id) } });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.deletePeopleJob(id)) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "People job not found." } }, { status: 404 });
  return NextResponse.json({ success: true, data: { id } });
}

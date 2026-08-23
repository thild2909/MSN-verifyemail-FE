import { NextResponse } from "next/server";
import { z } from "zod";
import * as store from "@/server/job-collect-store";
import { startJobSearch } from "@/server/job-collect-job";
import { JOB_SOURCES } from "@/lib/leads/job-collect-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sources: z.array(z.enum(JOB_SOURCES)).min(1),
  keywords: z.string().trim().min(1).max(200),
  location: z.string().trim().max(120).default(""),
  maxPages: z.number().int().min(1).max(20).default(3),
});

export async function GET() {
  return NextResponse.json({ success: true, data: store.listJobSearches() });
}

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid body." } }, { status: 400 });
  }
  const { name, sources, keywords, location, maxPages } = parsed.data;
  const { job } = store.createJobSearch({ name, sources, params: { keywords, location, maxPages } });
  startJobSearch(job.id);
  return NextResponse.json({ success: true, data: job }, { status: 201 });
}

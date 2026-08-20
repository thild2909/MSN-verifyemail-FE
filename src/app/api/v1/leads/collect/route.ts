import { NextResponse } from "next/server";
import { z } from "zod";
import * as store from "@/server/company-collect-store";
import { startCollectJob } from "@/server/company-collect-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  fileName: z.string().trim().min(1),
  rows: z.array(z.object({ company: z.string(), location: z.string() })).min(1).max(5000),
});

export async function GET() {
  return NextResponse.json({ success: true, data: store.listCollectJobs() });
}

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid body." } }, { status: 400 });
  }
  // Company Name + Location are both required per row.
  const missing = parsed.data.rows.some((r) => !r.company.trim() || !r.location.trim());
  if (missing) {
    return NextResponse.json({ success: false, error: { code: "MISSING_FIELDS", message: "Every row needs both Company Name and Location." } }, { status: 400 });
  }
  const { job, truncated } = store.createCollectJob(parsed.data);
  startCollectJob(job.id);
  return NextResponse.json({ success: true, data: job, truncated }, { status: 201 });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import * as store from "@/server/linkedin-jobs-collect-store";
import { startLinkedInSearch } from "@/server/linkedin-jobs-collect-job";
import { LINKEDIN_JOB_TYPES } from "@/lib/leads/linkedin-jobs-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  keywords: z.array(z.string().trim().min(1)).min(1).max(20),
  locations: z.array(z.string().trim().max(120)).max(20).default([]),
  datePosted: z.enum(["24h", "7d", "30d", "any"]).default("any"),
  jobType: z.enum(LINKEDIN_JOB_TYPES).default("any"),
  targetRoles: z.array(z.string().trim()).max(30).default([]),
  maxAgeDays: z.number().int().min(0).max(365).default(0),
  maxPages: z.number().int().min(1).catch(30).default(30), // clamped downstream; never 400 on depth
  employeeMax: z.number().int().min(0).max(1_000_000).default(0),
  targetIndustries: z.array(z.string().trim()).max(30).default([]),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  params: paramsSchema,
});

export async function GET() {
  return NextResponse.json({ success: true, data: store.listLinkedInSearches() });
}

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid body." } }, { status: 400 });
  }
  const { job } = store.createLinkedInSearch(parsed.data);
  startLinkedInSearch(job.id);
  return NextResponse.json({ success: true, data: job }, { status: 201 });
}

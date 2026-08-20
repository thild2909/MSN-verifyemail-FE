import { NextResponse } from "next/server";
import { z } from "zod";
import * as store from "@/server/enrich-store";
import { startEnrichJob } from "@/server/enrich-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kindEnum = z.enum([
  "find_work_email", "verify_email", "find_phone", "find_linkedin",
  "enrich_company", "company_tech", "generic_emails", "ai_research",
]);

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  fileName: z.string().trim().min(1),
  recordType: z.enum(["people", "companies"]),
  importedColumns: z.array(z.string()).min(1),
  identityColumns: z.array(z.string()).default([]),
  rows: z.array(z.record(z.string())).min(1).max(5000),
  columns: z.array(kindEnum).default([]),
});

export async function GET() {
  return NextResponse.json({ success: true, data: store.listEnrichTables() });
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "Malformed JSON." } }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid body." } }, { status: 400 });
  }
  try {
    const { table, truncated } = store.createEnrichTable(parsed.data);
    startEnrichJob(table.id);
    return NextResponse.json({ success: true, data: table, truncated }, { status: 201 });
  } catch (err) {
    if (err instanceof store.CreditsError) {
      return NextResponse.json({ success: false, error: { code: err.code, message: err.message, required: err.required, available: err.available } }, { status: 402 });
    }
    return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not create enrichment table." } }, { status: 500 });
  }
}

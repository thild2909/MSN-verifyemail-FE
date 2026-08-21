import { NextResponse } from "next/server";
import { z } from "zod";
import * as store from "@/server/people-collect-store";
import * as companyStore from "@/server/company-collect-store";
import { startPeopleJob } from "@/server/people-collect-job";
import type { CollectedCompany } from "@/lib/leads/collect-types";
import type { PeopleSeedInput } from "@/lib/leads/people-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const seedSchema = z.object({
  companyId: z.string().nullish(),
  company: z.string().trim().min(1),
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  location: z.string().trim().optional().default(""),
  domain: z.string().trim().nullish(),
  website: z.string().trim().nullish(),
  linkedin: z.string().trim().nullish(),
});

// Two ways to create a people job:
//  1. explicit `seeds`
//  2. `fromCompanyJob` — seed from a company-collect job's resolved companies
//     (by `companyIds`, or all matching `search`/`filter` when `allMatching`).
const createSchema = z.union([
  z.object({ name: z.string().trim().min(1).max(120), seeds: z.array(seedSchema).min(1).max(500) }),
  z.object({
    name: z.string().trim().min(1).max(120),
    fromCompanyJob: z.string().trim().min(1),
    companyIds: z.array(z.string()).max(500).optional(),
    allMatching: z.boolean().optional(),
    search: z.string().optional(),
    status: z.array(z.string()).optional(),
    has: z.array(z.string()).optional(),
    email: z.array(z.string()).optional(),
    industries: z.array(z.string()).optional(),
  }),
]);

/** A company is a usable seed only if it resolved to real data. */
function seedFromCompany(c: CollectedCompany): PeopleSeedInput {
  return {
    companyId: c.id,
    company: c.inputName,
    location: c.inputLocation,
    domain: c.domainGuess || (c.website?.value ? String(c.website.value) : null),
    website: c.website?.value ? String(c.website.value) : null,
    linkedin: c.linkedin?.value ? String(c.linkedin.value) : null,
  };
}

export async function GET() {
  return NextResponse.json({ success: true, data: store.listPeopleJobs() });
}

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid body." } }, { status: 400 });
  }

  let seeds: PeopleSeedInput[];
  if ("seeds" in parsed.data) {
    seeds = parsed.data.seeds;
  } else {
    const { fromCompanyJob, companyIds, allMatching, search, status, has, email, industries } = parsed.data;
    if (!companyStore.getCollectJob(fromCompanyJob)) {
      return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Source company job not found." } }, { status: 404 });
    }
    let companies: CollectedCompany[];
    if (companyIds && companyIds.length && !allMatching) {
      companies = companyStore.companiesByIds(fromCompanyJob, companyIds);
    } else {
      // All companies matching the current search + filters (Select all N).
      companies = companyStore.getCompanies(fromCompanyJob, { search, status, has, email, industries, page: 1, pageSize: 100000 }).companies;
    }
    // Only companies that actually resolved can yield people.
    seeds = companies.filter((c) => c.status === "enriched").map(seedFromCompany);
    if (!seeds.length) {
      return NextResponse.json({ success: false, error: { code: "NO_SEEDS", message: "None of the selected companies are resolved yet — run collection first." } }, { status: 400 });
    }
  }

  const { job, truncated } = store.createPeopleJob({ name: parsed.data.name, seeds });
  startPeopleJob(job.id);
  return NextResponse.json({ success: true, data: job, truncated }, { status: 201 });
}

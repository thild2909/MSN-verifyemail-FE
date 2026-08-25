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
  // Optional CSV-imported fields (pre-fill the table; crawl fills the gaps).
  title: z.string().trim().nullish(),
  seniority: z.string().trim().nullish(),
  email: z.string().trim().nullish(),
  personLinkedin: z.string().trim().nullish(),
  mobile: z.string().trim().nullish(),
  twitter: z.string().trim().nullish(),
  facebook: z.string().trim().nullish(),
  photo: z.string().trim().nullish(),
  headline: z.string().trim().nullish(),
  department: z.string().trim().nullish(),
  companyEmployees: z.string().trim().nullish(),
  companyIndustry: z.string().trim().nullish(),
  companyPhone: z.string().trim().nullish(),
  companyEmail: z.string().trim().nullish(),
  // Raw location parts (location is the combined value).
  city: z.string().trim().nullish(),
  state: z.string().trim().nullish(),
  country: z.string().trim().nullish(),
  // Rich company detail (Apollo-style export).
  keywords: z.string().trim().nullish(),
  companyLinkedin: z.string().trim().nullish(),
  companyRevenue: z.string().trim().nullish(),
  companyFunding: z.string().trim().nullish(),
  companyTechnologies: z.string().trim().nullish(),
  companyFoundedYear: z.string().trim().nullish(),
  companySeoDescription: z.string().trim().nullish(),
  companyShortDescription: z.string().trim().nullish(),
  // Full snapshot from a saved list (import dedup) — shown as-is, no crawl.
  prefill: z.record(z.unknown()).nullish(),
});

// Two ways to create a people job:
//  1. explicit `seeds`
//  2. `fromCompanyJob` — seed from a company-collect job's resolved companies
//     (by `companyIds`, or all matching `search`/`filter` when `allMatching`).
const createSchema = z.union([
  // Accept large uploads; the store dedups + truncates to MAX_PEOPLE_SEEDS and
  // reports `truncated`, so a big file never hard-fails here.
  z.object({ name: z.string().trim().min(1).max(120), seeds: z.array(seedSchema).min(1).max(100000) }),
  z.object({
    name: z.string().trim().min(1).max(120),
    fromCompanyJob: z.string().trim().min(1),
    companyIds: z.array(z.string()).max(500).optional(),
    allMatching: z.boolean().optional(),
    search: z.string().optional(),
    company: z.array(z.string()).optional(),
    locations: z.array(z.string()).optional(),
    employees: z.array(z.string()).optional(),
    technologies: z.array(z.string()).optional(),
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
    companyEmployees: c.employees?.value != null ? String(c.employees.value) : null,
    companyIndustry: c.industry?.value != null ? String(c.industry.value) : null,
    companyPhone: c.phone?.value != null ? String(c.phone.value) : null,
    companyEmail: c.contactEmail?.value != null ? String(c.contactEmail.value) : null,
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
    // `prefill` is validated as an opaque record; it IS the stored CollectedPerson snapshot.
    seeds = parsed.data.seeds as PeopleSeedInput[];
  } else {
    const { fromCompanyJob, companyIds, allMatching, search, company, locations, employees, technologies, status, has, email, industries } = parsed.data;
    if (!companyStore.getCollectJob(fromCompanyJob)) {
      return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Source company job not found." } }, { status: 404 });
    }
    let companies: CollectedCompany[];
    if (companyIds && companyIds.length && !allMatching) {
      companies = companyStore.companiesByIds(fromCompanyJob, companyIds);
    } else {
      // All companies matching the current search + filters (Select all N).
      companies = companyStore.getCompanies(fromCompanyJob, { search, company, locations, employees, technologies, status, has, email, industries, page: 1, pageSize: 100000 }).companies;
    }
    // Only companies that actually resolved can yield people.
    seeds = companies.filter((c) => c.status === "enriched").map(seedFromCompany);
    if (!seeds.length) {
      return NextResponse.json({ success: false, error: { code: "NO_SEEDS", message: "None of the selected companies are resolved yet. Run collection first." } }, { status: 400 });
    }
  }

  const { job, truncated } = store.createPeopleJob({ name: parsed.data.name, seeds });
  startPeopleJob(job.id);
  return NextResponse.json({ success: true, data: job, truncated }, { status: 201 });
}

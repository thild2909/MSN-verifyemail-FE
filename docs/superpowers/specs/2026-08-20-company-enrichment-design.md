# Company Enrichment — Lead Finder (Design Spec)

**Date:** 2026-08-20
**Author:** david@mindsupernova.com
**Status:** Approved — ready for implementation plan

## 1. Summary

A new **Enrichment** section (`/enrich`) that runs the full closed lifecycle of
company-level lead generation. The user imports a CSV/XLSX of companies and the
system resolves, per company:

- **Website + firmographics** (industry, size, location, founded, socials)
- **Generic / support emails** (`support@`, `info@`, `sales@`, …), verified
- **People / leads** (name, title, seniority, department, email), verified

Results are persisted as **enrichment jobs** with a history table and a detail
page (filter, segment, drill-down, export). The loop closes by letting the user
**push discovered emails into a Verification List**, feeding the existing
verify pipeline.

The feature mirrors the existing **Verification Lists** architecture (persisted
jobs + detail page + fire-and-forget background runner) and **reuses the Finder
pipeline** (`findPersonEmail` / `cachedVerify`) so people at the same company
share the domain + email cache and cost few backend calls.

## 2. Lifecycle (closed loop)

```
Import companies (CSV/XLSX)
  → Configure (what to enrich + people filters + verify toggle + cost estimate)
    → Enrich job (background, live progress)
      → Filter / Segment (seniority, department, status, has-email, search)
        → Act (copy / verify / export CSV|XLSX / push → Verification List)
          → Manage (rename, reprocess, delete)
```

## 3. Data model (`src/lib/types.ts` additions)

```ts
export type EnrichStatus = "queued" | "enriching" | "completed" | "failed";
export type CompanyRecordStatus = "pending" | "enriched" | "no_domain" | "failed";
export type Seniority = "c_level" | "vp" | "director" | "manager" | "staff";
export type Department =
  | "engineering" | "sales" | "marketing" | "operations" | "hr" | "finance";
export type GenericEmailType =
  | "support" | "info" | "sales" | "contact" | "careers";

export interface CompanyProfile {
  website: string | null;      // resolved domain, e.g. "acme.com"
  industry: string | null;
  size: string | null;         // "51-200"
  location: string | null;     // "San Francisco, US"
  founded: number | null;
  linkedin: string | null;
  twitter: string | null;
  description: string | null;
  logoText: string;            // initials for the avatar
}

export interface GenericEmail {
  email: string;
  type: GenericEmailType;
  status: VerificationStatus | "unverified";
  score: number;
}

export interface DiscoveredPerson {
  id: string;
  name: string;
  jobTitle: string;
  seniority: Seniority;
  department: Department;
  email: string;
  score: number;
  state: FinderState;          // reuse finder verdict semantics
}

export interface CompanyRecord {
  id: string;
  jobId: string;
  inputName: string;           // as uploaded
  domainGuess: string;
  status: CompanyRecordStatus;
  profile?: CompanyProfile;
  genericEmails: GenericEmail[];
  people: DiscoveredPerson[];
  bestEmail?: string;          // primary company contact
  enrichedAt?: string;
}

export interface EnrichOptions {
  findWebsite: boolean;
  findGenericEmails: boolean;
  findPeople: boolean;
  verifyEmails: boolean;
  peopleFilter: {
    seniority: Seniority[];    // [] = all
    departments: Department[]; // [] = all
    perCompany: number;        // cap, e.g. 5
  };
}

export interface EnrichSummary {
  total: number;
  enriched: number;
  withWebsite: number;
  withEmail: number;
  peopleFound: number;
  noDomain: number;
}

export interface EnrichJob {
  id: string;
  name: string;
  fileName: string;
  status: EnrichStatus;
  uploadedRows: number;
  uniqueCompanies: number;
  progress: number;            // 0-100
  options: EnrichOptions;
  summary: EnrichSummary;
  createdAt: string;
  completedAt?: string;
}
```

## 4. Server pipeline — `src/server/enrich.ts`

`enrichCompany(inputName, options)`:

1. **Resolve website** — reuse the bulk-finder `toDomain()` slugify to turn a
   company name/URL into a bare domain. If unresolvable → `status: "no_domain"`.
2. **Firmographics** — deterministic mock keyed on `seededRandom(domain)` so the
   same company always yields the same industry/size/location/socials (stable
   across reruns, no `Math.random`).
3. **Generic emails** — build `support@/info@/sales@` on the domain; if
   `verifyEmails`, run each through `cachedVerify` (shared finder cache); keep
   deliverable/plausible ones. Otherwise mark `unverified`.
4. **People** — generate a roster with seniority/department, filter by
   `peopleFilter`, cap at `perCompany`, resolve each via `findPersonEmail`
   (shared domain + email cache → cheap), attach `state`.
5. Pick `bestEmail` (first verified person, else first verified generic email).

Accumulate resource-savings stats (`backendCalls`, `naiveCalls`, `saved`) the
same way `findManyEmails` does.

## 5. Store — `src/server/enrich-store.ts` (new file)

A dedicated singleton (kept out of `store.ts` to avoid bloating it) with its own
`.data/enrich.json` persistence, following `store.ts` patterns exactly:

- `createEnrichJob(input)` — dedupe by normalized company name, cap rows, credit
  gate via exported `charge()`, seed pending `CompanyRecord`s, return job.
- `getEnrichJobs()` / `getEnrichJob(id)`
- `getCompanies(jobId, query)` — pagination + `search` + `filter`
  (status / has-email / seniority / department applied to `people`).
- `rawCompanies(jobId)` — for the job runner.
- `applyCompany(jobId, companyId, record)` — write result, recompute summary/progress.
- `finalizeEnrichJob(jobId)`
- `deleteEnrichJob(id)` / `renameEnrichJob(id, name)` / `reprocessEnrichJob(id)`

Reuses `CreditsError` semantics for the credit gate.

## 6. Background runner — `src/server/enrich-job.ts`

Fire-and-forget, mirroring `verification-job.ts`: a bounded worker pool walks
pending companies, calls `enrichCompany`, writes back via `applyCompany`, then
`finalizeEnrichJob`. GET reflects live progress. A `running` Set prevents
double-start.

## 7. API — `/api/v1/enrich/*`

All use the `{ success, data, error }` envelope, `runtime = "nodejs"`,
`dynamic = "force-dynamic"`, Zod validation.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/enrich` | Create job (name, fileName, companies[], options), credit gate, startEnrichJob, 201 |
| GET | `/api/v1/enrich` | List jobs |
| GET | `/api/v1/enrich/[id]` | One job |
| GET | `/api/v1/enrich/[id]/companies` | Filtered/paginated companies (`?filter&search&page&pageSize`) |
| PATCH | `/api/v1/enrich/[id]` | Rename |
| DELETE | `/api/v1/enrich/[id]` | Delete |
| POST | `/api/v1/enrich/[id]/reprocess` | Re-run (charges credits) |
| GET | `/api/v1/enrich/[id]/export` | `?format=csv\|xlsx&scope=companies\|people` |
| POST | `/api/v1/enrich/[id]/push-to-verification` | Create a Verification List from discovered emails (loop-closer) |

## 8. Client — `src/lib/api/client.ts` additions

`createEnrichJob`, `getEnrichJobs`, `getEnrichJob`, `getCompanies`,
`renameEnrichJob`, `deleteEnrichJob`, `reprocessEnrichJob`, `enrichExportUrl`,
`pushEnrichToVerification`. Same `apiGet` / `apiPost` helpers.

## 9. FE pages & components

- `app/(app)/enrich/page.tsx` — PageHeader + **jobs table** + "New enrichment"
  (opens import flow). Empty state when no jobs.
- `app/(app)/enrich/[id]/page.tsx` — **detail**: stat cards (from summary) +
  **filter bar** + **companies table** (row expand → drawer) + actions
  (export, push-to-verification, reprocess).
- Components (`src/components/enrich/`):
  - `enrich-jobs-table.tsx` — mirrors `lists-table` (view / rename / delete /
    reprocess / export via dropdown).
  - `import-flow.tsx` — FileDropzone → column mapping (company name / optional
    domain column) → **options panel** (toggles website/generic/people; people
    filters: seniority multiselect, departments multiselect, per-company cap;
    verify toggle) → **credit estimate** → create.
  - `companies-table.tsx` — filterable rows: logo, name, website, industry/size,
    #people, best email, status chip. Expand → drawer.
  - `company-detail-drawer.tsx` — profile card, generic emails list (copy /
    verify), people table (name / title / dept / email / state; copy / verify).
  - `enrich-filters.tsx` — status / seniority / department / has-email / search.
- Nav (`src/lib/nav.ts`): add `{ label: "Enrichment", href: "/enrich",
  icon: Building2 }` right after "Email Finder".

## 10. Credits

Charge `email_finder`. Estimate = `companies × (1 + (findPeople ? perCompany : 0))`.
Show the estimate before running; gate on balance like `createList`. Deduct on
job creation; reprocess re-charges.

## 11. Verification approach

No test suite exists in the repo. Verify with:

- `npm run typecheck` (tsc --noEmit) — must be clean.
- `npm run lint` — must be clean.
- `npm run build` — must succeed.
- Manual `npm run dev` smoke: import example CSV → job runs → detail page filters
  → export → push-to-verification creates a list.

## 12. YAGNI (explicitly out of scope)

- Real social/website scraping (mock, deterministic only).
- Webhook / integration push for enrichment.
- Separate analytics dashboard for enrichment.
- New test framework (repo has none).
```

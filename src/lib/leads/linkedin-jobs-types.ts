/**
 * Find Leads — LinkedIn Job Scraper model.
 *
 * A LinkedIn scrape takes one or more keyword × location QUERIES and, for each,
 * runs the guest-API pipeline through the crawler-service:
 *
 *   Discovery → Parse & Normalize → Deduplicate → Filter/Qualify → (opt-in) Enrich & Score
 *
 * Unlike the Jobs tab (fans out over BOARDS) this fans out over QUERIES: each
 * keyword×location pair is one unit of work producing many roles, deduped by
 * `linkedinJobId`. The expensive per-item work — job-detail fetch + company-page
 * scrape for employee-count/industry — is a SEPARATE opt-in "Qualify companies"
 * pass, keeping the crawl fast and honoring the opt-in-expensive-ops rule.
 */

export type LinkedInDatePosted = "24h" | "7d" | "30d" | "any";

export const LINKEDIN_DATE_LABEL: Record<LinkedInDatePosted, string> = {
  "24h": "Past 24 hours", "7d": "Past week", "30d": "Past month", any: "Any time",
};

/** Employment-type keys (`f_JT`) plus "remote" (workplace type, `f_WT=2`). */
export const LINKEDIN_JOB_TYPES = ["any", "full_time", "part_time", "contract", "internship", "temporary", "remote"] as const;
export type LinkedInJobType = (typeof LINKEDIN_JOB_TYPES)[number];
export const LINKEDIN_JOB_TYPE_LABEL: Record<LinkedInJobType, string> = {
  any: "Any", full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship", temporary: "Temporary", remote: "Remote",
};

/** normal = keyword as typed (Python); polygon = exact phrase, wrapped in quotes ("python"). */
export const LINKEDIN_SEARCH_MODES = ["normal", "polygon"] as const;
export type LinkedInSearchMode = (typeof LINKEDIN_SEARCH_MODES)[number];

/** Role families the normalizer maps titles onto — also the crawl's target-role picker. */
export const LINKEDIN_ROLE_FAMILIES = [
  "Software Engineer", "Backend Engineer", "Frontend Engineer", "Fullstack Engineer",
  "DevOps / SRE", "Cloud Engineer", "Data Engineer", "Data Scientist", "Data Analyst",
  "ML / AI Engineer", "Mobile Engineer", "QA Engineer", "Security Engineer", "Engineering Manager",
] as const;
export type LinkedInRoleFamily = (typeof LINKEDIN_ROLE_FAMILIES)[number];

export type LinkedInEnrichStatus = "idle" | "enriching" | "enriched";
export type LinkedInCollectStatus = "collecting" | "completed" | "failed";

/** One open role discovered on LinkedIn, after normalization + (opt-in) enrichment. */
export interface CollectedLinkedInJob {
  id: string; // row id: `${jobId}_${index}`
  jobId: string; // parent scrape id
  // identity
  linkedinJobId: string; // dedup primary key
  jobUrl: string;
  title: string;
  company: string;
  companyLogoText: string;
  companyLinkedinUrl: string | null;
  location: string | null;
  // detail (filled by the opt-in enrich pass)
  description: string | null;
  postedAt: string | null; // ISO
  postedText: string | null;
  postedDaysAgo: number | null;
  applicants: number | null;
  employmentType: string | null;
  seniority: string | null;
  jobFunction: string | null;
  industries: string[];
  // normalized
  country: string | null;
  city: string | null;
  remote: boolean;
  roleFamily: string | null;
  primaryLanguage: string | null;
  seniorityLevel: string | null;
  // company enrichment
  companyEmployeeRange: string | null;
  companyEmployeeMin: number | null;
  companyIndustry: string | null;
  companyWebsite: string | null;
  // commercial strength (Qualify pass): LinkedIn page + DeepSeek knowledge
  companyType?: string | null; // LinkedIn "Type": "Public Company" / "Privately Held" …
  companyAffiliates?: string[]; // affiliated COMPANY pages (same group)
  companyRevenue?: string | null; // annual revenue band, e.g. "$10M-$50M"
  companyParentGroup?: string | null; // owning / strategic corporate group, e.g. "Grab"
  companyParentSource?: string | null; // URL of the web evidence (live-search backing only)
  // scoring / qualification
  fitScore: number; // 0-100
  qualified: boolean;
  rejectReason: string | null;
  enriched: boolean;
  // provenance
  sourceQuery: string;
  discoveredAt: string;
}

/** The filter state that seeds a scrape (mapped onto guest search params). */
export interface LinkedInScrapeParams {
  keywords: string[]; // one discovery query per keyword
  locations: string[]; // × each location ("" = worldwide)
  datePosted: LinkedInDatePosted;
  jobType: LinkedInJobType;
  searchMode?: LinkedInSearchMode; // absent on older saved scrapes = "normal"
  targetRoles: string[]; // role families to keep ([] = keep all)
  maxAgeDays: number; // 0 = any
  maxPages: number; // discovery pages per query (10 cards each); 0 = ALL results (auto-split into ≤1,000 slices)
  // company qualification (applied by the opt-in enrich pass)
  employeeMax: number; // 0 = no maximum (keep companies at or below this size)
  targetIndustries: string[]; // substrings to match against company industry ([] = any)
}

export interface LinkedInSearchSummary {
  queries: number; // keyword×location combos
  queriesDone: number;
  jobs: number; // deduped roles discovered
  qualified: number; // roles verified by the Qualify pass
  pending?: number; // roles awaiting the Qualify pass (optional: older saved summaries lack it)
  companies: number; // distinct employers
  enriched: number; // roles with detail/company enrichment
  blocked: number; // queries walled with no results
  pagesCrawled: number;
}

export interface LinkedInSearchJob {
  id: string;
  name: string;
  params: LinkedInScrapeParams;
  status: LinkedInCollectStatus;
  enrichStatus: LinkedInEnrichStatus;
  progress: number; // 0-100 (queries done / queries)
  summary: LinkedInSearchSummary;
  createdAt: string;
  completedAt?: string;
}

/** Per-query coverage line. */
export interface LinkedInQueryCoverage {
  key: string; // `${keyword} @ ${location||"worldwide"}`
  keyword: string;
  location: string;
  status: "pending" | "collecting" | "done" | "blocked" | "failed";
  jobsFound: number;
  pages: number;
  /** LinkedIn's reported total for the query ("3,000+" → 3000 + capped) */
  total?: number | null;
  totalCapped?: boolean;
  /** full-coverage mode: slices walked so far (time windows / "kw AND term") */
  slices?: number;
  error?: string; // why a query failed/blocked (shown on the coverage chip)
}

export function emptyLinkedInSummary(queries: number): LinkedInSearchSummary {
  return { queries, queriesDone: 0, jobs: 0, qualified: 0, pending: 0, companies: 0, enriched: 0, blocked: 0, pagesCrawled: 0 };
}

/* ------------------------- client-side result filters -------------------- */

export interface LinkedInJobFilters {
  search: string;
  roleFamilies: string[];
  countries: string[];
  seniorities: string[];
  industries: string[]; // include: keep only these (company industry, known after Qualify)
  excludedIndustries: string[]; // exclude: drop these
  employeeRanges: string[]; // company size bands ("11-50 employees"), known after Qualify
  remoteOnly: boolean;
  qualifiedOnly: boolean;
  minScore: number; // 0 = any
  postedWithinDays: number; // 0 = any
}

export const DEFAULT_LINKEDIN_FILTERS: LinkedInJobFilters = {
  search: "",
  roleFamilies: [],
  countries: [],
  seniorities: [],
  industries: [],
  excludedIndustries: [],
  employeeRanges: [],
  remoteOnly: false,
  qualifiedOnly: false, // rows are unqualified until the user runs "Qualify companies"
  minScore: 0,
  postedWithinDays: 0,
};

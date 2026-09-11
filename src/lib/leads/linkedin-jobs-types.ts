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

/** Employment-type keys accepted by the guest `f_JT` filter. */
export const LINKEDIN_JOB_TYPES = ["any", "full_time", "part_time", "contract", "internship", "temporary"] as const;
export type LinkedInJobType = (typeof LINKEDIN_JOB_TYPES)[number];
export const LINKEDIN_JOB_TYPE_LABEL: Record<LinkedInJobType, string> = {
  any: "Any", full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship", temporary: "Temporary",
};

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
  targetRoles: string[]; // role families to keep ([] = keep all)
  maxAgeDays: number; // 0 = any
  maxPages: number; // discovery pages per query (25 cards each)
  // company qualification (applied by the opt-in enrich pass)
  employeeMax: number; // 0 = no maximum (keep companies at or below this size)
  targetIndustries: string[]; // substrings to match against company industry ([] = any)
}

export interface LinkedInSearchSummary {
  queries: number; // keyword×location combos
  queriesDone: number;
  jobs: number; // deduped roles discovered
  qualified: number; // roles passing the qualification gate
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
  error?: string; // why a query failed/blocked (shown on the coverage chip)
}

export function emptyLinkedInSummary(queries: number): LinkedInSearchSummary {
  return { queries, queriesDone: 0, jobs: 0, qualified: 0, companies: 0, enriched: 0, blocked: 0, pagesCrawled: 0 };
}

/* ------------------------- client-side result filters -------------------- */

export interface LinkedInJobFilters {
  search: string;
  roleFamilies: string[];
  countries: string[];
  seniorities: string[];
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
  remoteOnly: false,
  qualifiedOnly: true, // qualified-only by default; rejected rows are one toggle away
  minScore: 0,
  postedWithinDays: 0,
};

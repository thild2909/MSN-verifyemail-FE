/**
 * Find Leads — Company multi-source collection + proxy configuration model.
 *
 * A collection job imports companies (Company Name + Location required) and
 * "collects" a full company profile the way Clay/Apollo do — from several
 * sources (LinkedIn, website, Google Maps, social, other), each field tagged
 * with the source that provided it. Collection runs through a configurable
 * PROXY layer (rotation + delay + backoff) so it can avoid rate limits.
 *
 * NOTE: gated-source scraping (LinkedIn/Google Maps) is SIMULATED in this demo
 * — the field values are deterministic mock. The proxy layer, rotation and
 * rate-limit handling are real, configurable, and drive the collection log, so
 * a real collector can be slotted in behind the same interface later.
 */
import type { VerificationStatus } from "@/lib/types";

// `search` (the resolver) runs first to find the REAL domain; `website` is the
// real crawl and takes precedence over the simulated sources for shared fields.
export const COLLECTION_SOURCES = [
  "search", "website", "opencorporates", "linkedin", "google_maps", "directory", "social", "llm", "other",
] as const;
export type CollectionSource = (typeof COLLECTION_SOURCES)[number];

/**
 * Sources whose values are simulated. The live crawler-service produces only
 * REAL data (Brave search + website crawl + registry/profile mined from real
 * results), so nothing is simulated any more — kept for backward compatibility.
 */
export const SIMULATED_SOURCES: readonly CollectionSource[] = [];

export interface SourcedField<T = string> {
  value: T;
  source: CollectionSource;
  confidence: number; // 0-100
  agreement?: number; // how many independent sources supplied this same value
}

/**
 * Deliverability verdict for a company's contact email, produced by the
 * `check-if-email-exists` backend (or the local mock when it is unreachable).
 */
export interface EmailVerification {
  email: string;
  status: VerificationStatus | "not_found";
  score: number; // 0-100
  provider: "reacher" | "mock";
  verifiedAt: string; // ISO
}

/** What the Company Resolver found before any crawling. */
export interface ResolutionInfo {
  website: string | null;
  linkedin: string | null;
  confidence: number; // 0-100
  provider: string; // "duckduckgo" | "serper" | "serpapi" | "brave" | "guess"
  query: string; // the query that produced the winning result
  cacheHit: boolean;
}

export type CollectStatus = "pending" | "collecting" | "enriched" | "not_found" | "failed";

/** One attempt to collect from a single source (what the log shows). */
export interface CollectionAttempt {
  source: CollectionSource;
  status: "ok" | "rate_limited" | "retried" | "blocked" | "skipped";
  proxy: string | null; // label of the proxy that served it, or null (direct)
  ms: number; // latency (real for real sources, estimated for simulated)
  fieldsFound: number;
  simulated?: boolean; // this source's values are mock, not really fetched
  cacheHit?: boolean; // result came from the 30-day cache
  pages?: number; // pages crawled (website source)
  provider?: string; // search provider used (search source)
  detail?: string; // one human-readable line (e.g. resolved domain / query)
}

export interface CollectedCompany {
  id: string;
  jobId: string;
  inputName: string;
  inputLocation: string;
  domainGuess: string;
  logoText: string;
  status: CollectStatus;
  resolution: ResolutionInfo | null;
  // Source-attributed fields
  website: SourcedField | null;
  emailDomain: SourcedField | null;
  contactEmail: SourcedField | null;
  phone: SourcedField | null;
  linkedin: SourcedField | null;
  twitter: SourcedField | null;
  facebook: SourcedField | null;
  address: SourcedField | null;
  mapsRating: SourcedField<number> | null;
  industry: SourcedField | null;
  employees: SourcedField | null;
  revenue: SourcedField | null;
  founded: SourcedField<number> | null;
  description: SourcedField | null;
  technologies: SourcedField<string[]> | null;
  // Legal entity (OpenCorporates)
  legalName: SourcedField | null;
  jurisdiction: SourcedField | null;
  registrationNumber: SourcedField | null;
  incorporated: SourcedField<number> | null;
  emailVerification: EmailVerification | null;
  // Entity-resolution outputs from the crawler service (real).
  matchScore?: number; // raw signal sum (e.g. 120)
  verification?: CompanyVerification;
  llmVerification?: LlmVerdict | null; // DeepSeek cross-check (opt-in)
  collection: CollectionAttempt[];
}

/**
 * LLM cross-check verdict (DeepSeek). An independent, knowledge-based audit of a
 * collected record — catches semantic errors the heuristics can't (e.g. a
 * website that belongs to a different company, or a founder at the wrong firm).
 */
export interface LlmVerdict {
  status: "verified" | "mismatch" | "uncertain";
  confidence: number; // 0-100
  reason: string; // short human-readable rationale
  suggestion?: string; // corrected value when status = mismatch
  model: string;
  verifiedAt: string; // ISO
}

/** Website ↔ LinkedIn cross-verification result from the crawler service. */
export interface CompanyVerification {
  name_match: boolean;
  location_match: boolean;
  website_match: boolean;
  linkedin_match: boolean;
  cross_verified: boolean;
}

export interface CollectSummary {
  total: number;
  enriched: number;
  resolved: number; // resolver found a real website or LinkedIn
  withWebsite: number;
  withEmail: number;
  withPhone: number;
  withLinkedin: number;
  withLegalEntity: number;
  cacheHits: number;
  rateLimited: number;
  proxyRotations: number;
  emailsVerified: number; // contact emails checked through the verifier backend
  emailsValid: number; // of those, deliverable (status "valid")
}

/** Phase of the automatic email-verification pass that follows collection. */
export type VerifyStatus = "idle" | "verifying" | "done";

export type CollectJobStatus = "queued" | "collecting" | "completed" | "failed";

export interface CompanyCollectJob {
  id: string;
  name: string;
  fileName: string;
  status: CollectJobStatus;
  verifyStatus: VerifyStatus; // email-verification pass after collection
  total: number;
  progress: number; // 0-100
  summary: CollectSummary;
  createdAt: string;
  completedAt?: string;
}

/** Faceted filter state for the Companies table sidebar. */
export interface CompanyFilters {
  company: string[]; // company-name contains any (OR)
  locations: string[]; // location contains any (OR)
  employees: string[]; // size buckets, see EMPLOYEE_BUCKETS (OR)
  industries: string[]; // (OR)
  technologies: string[]; // tech stack contains any (OR)
  status: string[]; // enriched | not_found
  has: string[]; // website | email | phone | linkedin (all required)
  email: string[]; // valid | bad
}

export const EMPTY_COMPANY_FILTERS: CompanyFilters = {
  company: [], locations: [], employees: [], industries: [], technologies: [], status: [], has: [], email: [],
};

/** Total number of active filter constraints — kept here so the panel and the
 *  table badge never drift out of sync. */
export const countCompanyFilters = (f: CompanyFilters): number =>
  f.company.length + f.locations.length + f.employees.length + f.industries.length +
  f.technologies.length + f.status.length + f.has.length + f.email.length;

/** Employee-size buckets. `min`/`max` are inclusive head-count bounds. */
export const EMPLOYEE_BUCKETS: { value: string; label: string; min: number; max: number }[] = [
  { value: "1-10", label: "1–10", min: 1, max: 10 },
  { value: "11-50", label: "11–50", min: 11, max: 50 },
  { value: "51-200", label: "51–200", min: 51, max: 200 },
  { value: "201-1000", label: "201–1,000", min: 201, max: 1000 },
  { value: "1001-5000", label: "1,001–5,000", min: 1001, max: 5000 },
  { value: "5000+", label: "5,000+", min: 5001, max: Number.POSITIVE_INFINITY },
];

/** Best integer for bucketing: upper end of a range, else the sole count. */
export function employeeCount(value: unknown): number | null {
  if (value == null) return null;
  const s = String(value).replace(/,/g, "");
  const range = s.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (range) return Number(range[2]);
  const plus = s.match(/(\d+)\+/);
  if (plus) return Number(plus[1]);
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** Map a free-text employees value to a bucket key, or null if unparseable. */
export function employeeBucket(value: unknown): string | null {
  const n = employeeCount(value);
  if (n == null) return null;
  return EMPLOYEE_BUCKETS.find((b) => n >= b.min && n <= b.max)?.value ?? null;
}

/** Facet counts (over all companies in the job) for the sidebar. */
export interface CompaniesFacets {
  status: Record<string, number>;
  has: { website: number; email: number; phone: number; linkedin: number };
  email: { valid: number; bad: number };
  industries: { name: string; count: number }[];
  technologies: { name: string; count: number }[];
  employees: Record<string, number>; // bucket value -> count
}

/* --------------------------------- proxies ------------------------------- */

export const PROXY_TYPES = ["http", "https", "socks5"] as const;
export type ProxyType = (typeof PROXY_TYPES)[number];

export const ROTATION_STRATEGIES = ["round_robin", "random", "sticky_per_domain"] as const;
export type RotationStrategy = (typeof ROTATION_STRATEGIES)[number];

export type ProxyHealth = "untested" | "healthy" | "slow" | "dead";

export interface ProxyEntry {
  id: string;
  label: string;
  host: string;
  port: number;
  type: ProxyType;
  hasAuth: boolean; // credentials present (never returned in the clear)
  username?: string;
  country?: string;
  enabled: boolean;
  status: ProxyHealth;
  lastLatencyMs?: number;
  exitIp?: string; // the IP seen by the target when tested through this proxy
}

/** Rotating residential endpoint status (from the crawler service). */
export interface RotatingProxy {
  active: boolean; // in effect (overrides the static pool)
  source: "env" | "config" | "none";
  editable: boolean; // false when locked by an env var
  endpoint: string; // masked (password hidden)
  status?: ProxyHealth;
  lastLatencyMs?: number;
  exitIp?: string;
  error?: string;
}

/** Webshare list download pool (CRAWLER_PROXY_LIST_URL). */
export interface ProxyPoolList {
  active: boolean;
  source: "env" | "none";
  count: number;
  lastLoadedAt?: number;
  error?: string;
}

/** Static residential pool — retry-only fallback after datacenter IPs fail. */
export interface ProxyRetryPool {
  active: boolean;
  source: "env" | "none";
  count: number;
  lastLoadedAt?: number;
  error?: string;
}

export interface ProxyTestProgress {
  running: boolean;
  total: number;
  done: number;
  healthy: number;
  slow: number;
  dead: number;
  currentHost?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface ProxyConfig {
  enabled: boolean; // route collection through the proxy pool
  rotation: RotationStrategy;
  concurrency: number; // max parallel requests
  delayMs: number; // base polite delay between requests
  backoffMs: number; // wait added on a rate-limit before retrying
  maxRetries: number;
  proxies: ProxyEntry[];
  rotating?: RotatingProxy;
  poolList?: ProxyPoolList;
  retryPool?: ProxyRetryPool;
  testProgress?: ProxyTestProgress;
}

export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  enabled: false,
  rotation: "round_robin",
  concurrency: 3,
  delayMs: 800,
  backoffMs: 2000,
  maxRetries: 2,
  proxies: [],
};

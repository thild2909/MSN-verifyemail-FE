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

// Website is first so its REAL parsed data takes precedence over the simulated sources.
export const COLLECTION_SOURCES = ["website", "linkedin", "google_maps", "social", "other"] as const;
export type CollectionSource = (typeof COLLECTION_SOURCES)[number];

export interface SourcedField<T = string> {
  value: T;
  source: CollectionSource;
  confidence: number; // 0-100
}

export type CollectStatus = "pending" | "collecting" | "enriched" | "not_found" | "failed";

/** One attempt to collect from a single source (what the log shows). */
export interface CollectionAttempt {
  source: CollectionSource;
  status: "ok" | "rate_limited" | "retried" | "blocked" | "skipped";
  proxy: string | null; // label of the proxy that served it, or null (direct)
  ms: number; // (simulated) latency
  fieldsFound: number;
}

export interface CollectedCompany {
  id: string;
  jobId: string;
  inputName: string;
  inputLocation: string;
  domainGuess: string;
  logoText: string;
  status: CollectStatus;
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
  collection: CollectionAttempt[];
}

export interface CollectSummary {
  total: number;
  enriched: number;
  withWebsite: number;
  withEmail: number;
  withPhone: number;
  withLinkedin: number;
  rateLimited: number;
  proxyRotations: number;
}

export type CollectJobStatus = "queued" | "collecting" | "completed" | "failed";

export interface CompanyCollectJob {
  id: string;
  name: string;
  fileName: string;
  status: CollectJobStatus;
  total: number;
  progress: number; // 0-100
  summary: CollectSummary;
  createdAt: string;
  completedAt?: string;
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

export interface ProxyConfig {
  enabled: boolean; // route collection through the proxy pool
  rotation: RotationStrategy;
  concurrency: number; // max parallel requests
  delayMs: number; // base polite delay between requests
  backoffMs: number; // wait added on a rate-limit before retrying
  maxRetries: number;
  proxies: ProxyEntry[];
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

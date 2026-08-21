/**
 * Client for the standalone crawler-service. The Find Leads → Companies flow
 * calls it to resolve each company to REAL data (website, LinkedIn, email,
 * legal entity, match score, cross-verification) and maps the service's
 * canonical record onto the FE's CollectedCompany shape. No mock data.
 */
import "server-only";
import { initials } from "@/lib/utils";
import type {
  CollectedCompany,
  CollectionAttempt,
  CollectionSource,
  CompanyVerification,
  ResolutionInfo,
  SourcedField,
} from "@/lib/leads/collect-types";

const BASE = process.env.CRAWLER_SERVICE_URL ?? "http://localhost:8090";
const TIMEOUT_MS = Number(process.env.CRAWLER_TIMEOUT_MS ?? 120_000);

interface CanonField {
  value: string | number;
  source: string;
  confidence: number;
  agreement?: number;
}
interface CanonicalCompany {
  input_company_name: string;
  input_location: string;
  company_name: string | null;
  website: string | null;
  linkedin: string | null;
  country: string | null;
  match_score: number;
  confidence: number;
  status: "accepted" | "needs_review" | "not_found";
  verification: CompanyVerification;
  fields: Record<string, CanonField>;
  log: { step: string; status: string; ms: number; detail?: string }[];
  cache_hit: boolean;
}

const hostOf = (u: string | null): string => {
  if (!u) return "";
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./i, "");
  } catch {
    return u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
  }
};

// The crawler emits sources ("search" | "website" | "opencorporates") that are
// already valid CollectionSource values.
const asSource = (s: string): CollectionSource => (["search", "website", "opencorporates", "linkedin", "google_maps", "directory", "social", "other"].includes(s) ? (s as CollectionSource) : "other");

function field(f: CanonField | undefined): SourcedField | null {
  if (!f) return null;
  return { value: String(f.value), source: asSource(f.source), confidence: f.confidence, agreement: f.agreement };
}
function numField(f: CanonField | undefined): SourcedField<number> | null {
  if (!f) return null;
  return { value: Number(f.value), source: asSource(f.source), confidence: f.confidence, agreement: f.agreement };
}

const STEP_SOURCE: Record<string, CollectionSource> = { resolve: "search", website: "website", opencorporates: "opencorporates", registry: "opencorporates", profile: "linkedin", cross_verify: "search" };
const STEP_STATUS: Record<string, CollectionAttempt["status"]> = { ok: "ok", blocked: "blocked", skipped: "skipped", partial: "retried", rate_limited: "rate_limited" };

function mapCanonical(c: CanonicalCompany): Omit<CollectedCompany, "id" | "jobId"> {
  const f = c.fields ?? {};
  const resolveLog = c.log?.find((l) => l.step === "resolve");
  const provider = resolveLog?.detail?.split("·")[0]?.trim() || "crawler";

  const resolution: ResolutionInfo = {
    website: c.website,
    linkedin: c.linkedin,
    confidence: Math.round((c.confidence ?? 0) * 100),
    provider,
    query: resolveLog?.detail ?? "",
    cacheHit: !!c.cache_hit,
  };

  const collection: CollectionAttempt[] = (c.log ?? []).map((l) => ({
    source: STEP_SOURCE[l.step] ?? "other",
    status: STEP_STATUS[l.status] ?? "ok",
    proxy: null,
    ms: l.ms ?? 0,
    fieldsFound: 0,
    detail: l.detail,
    simulated: false,
  }));

  return {
    inputName: c.input_company_name,
    inputLocation: c.input_location,
    domainGuess: hostOf(c.website),
    logoText: initials(c.company_name || c.input_company_name),
    status: c.status === "not_found" ? "not_found" : "enriched",
    resolution,
    website: field(f.website),
    emailDomain: field(f.emailDomain),
    contactEmail: field(f.contactEmail),
    phone: field(f.phone),
    linkedin: field(f.linkedin),
    twitter: field(f.twitter),
    facebook: field(f.facebook),
    address: field(f.address),
    mapsRating: numField(f.mapsRating),
    industry: field(f.industry),
    employees: field(f.employees),
    revenue: field(f.revenue),
    founded: numField(f.founded),
    description: field(f.description),
    technologies: null,
    legalName: field(f.legalName),
    jurisdiction: field(f.jurisdiction),
    registrationNumber: field(f.registrationNumber),
    incorporated: numField(f.incorporated),
    emailVerification: null,
    matchScore: c.match_score,
    verification: c.verification,
    collection,
  };
}

/** Resolve one company through the crawler service. Throws on transport error. */
export async function resolveViaCrawler(name: string, location: string): Promise<Omit<CollectedCompany, "id" | "jobId">> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: name, location }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`crawler-service responded ${res.status}`);
    return mapCanonical((await res.json()) as CanonicalCompany);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------- people ---------------------------------- */

import type { CollectedPerson, PersonSeniority, PeopleSeedInput } from "@/lib/leads/people-types";

interface CanonicalPerson {
  name: string;
  first_name: string;
  last_name: string;
  title: string;
  seniority: PersonSeniority;
  linkedin: string | null;
  company: string;
  company_domain: string | null;
  location: string | null;
  email: string | null;
  email_kind: "found" | "pattern" | "none";
  confidence: number;
  source_query: string;
}
interface PeopleResult {
  input_company_name: string;
  people: CanonicalPerson[];
  provider: string;
  blocked: boolean;
  count: number;
}

/** Fields a crawled person carries before the store assigns id/jobId. */
export type CrawledPerson = Omit<CollectedPerson, "id" | "jobId" | "companyId" | "companyLogoText">;

function mapPerson(p: CanonicalPerson): CrawledPerson {
  const found = p.email_kind === "found";
  return {
    company: p.company,
    companyDomain: p.company_domain,
    name: p.name,
    firstName: p.first_name,
    lastName: p.last_name,
    title: p.title ? { value: p.title, source: "linkedin", confidence: p.confidence } : null,
    seniority: p.seniority,
    linkedin: p.linkedin ? { value: p.linkedin.replace(/^https?:\/\//i, ""), source: "linkedin", confidence: 90 } : null,
    email: p.email ? { value: p.email, source: found ? "website" : "other", confidence: found ? 80 : 55 } : null,
    emailKind: p.email_kind,
    location: p.location,
    confidence: p.confidence,
    emailVerification: null,
    collection: [
      { source: "search", status: "ok", proxy: null, ms: 0, fieldsFound: 1, detail: p.source_query, provider: "brave" },
    ],
  };
}

/**
 * Discover the decision-makers (founders / C-level / VP) of one company through
 * the crawler service. Returns the crawled people plus the provider/blocked
 * status so the job can log rate-limits. Throws on transport error.
 */
interface PersonEnrichResult {
  person: CanonicalPerson;
  matched: boolean;
  provider: string;
  blocked: boolean;
}

/**
 * Enrich ONE known person (first + last + company) → their LinkedIn / title /
 * email. Returns the crawled person plus whether a profile actually matched.
 */
export async function resolvePersonViaCrawler(seed: PeopleSeedInput): Promise<{ person: CrawledPerson; matched: boolean; provider: string; blocked: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/person`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: seed.firstName ?? "",
        last_name: seed.lastName ?? "",
        company: seed.company,
        location: seed.location ?? "",
        domain: seed.domain ?? undefined,
        website: seed.website ?? undefined,
        linkedin: seed.linkedin ?? undefined,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`crawler-service /person responded ${res.status}`);
    const data = (await res.json()) as PersonEnrichResult;
    return { person: mapPerson(data.person), matched: data.matched, provider: data.provider, blocked: data.blocked };
  } finally {
    clearTimeout(timer);
  }
}

export async function resolvePeopleViaCrawler(seed: PeopleSeedInput): Promise<{ people: CrawledPerson[]; provider: string; blocked: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/people`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: seed.company,
        location: seed.location ?? "",
        domain: seed.domain ?? undefined,
        website: seed.website ?? undefined,
        linkedin: seed.linkedin ?? undefined,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`crawler-service /people responded ${res.status}`);
    const data = (await res.json()) as PeopleResult;
    return { people: (data.people ?? []).map(mapPerson), provider: data.provider, blocked: data.blocked };
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------- LLM cross-check ----------------------------- */

export interface LlmVerdictOut {
  id: string;
  status: "verified" | "mismatch" | "uncertain";
  confidence: number;
  reason: string;
  suggestion?: string;
}
export interface LlmVerifyResponse { configured: boolean; verdicts: LlmVerdictOut[]; tokens: number; model: string }

export interface CompanyLlmRecord { id: string; name: string; website?: string | null; linkedin?: string | null; industry?: string | null; location?: string | null; employees?: string | null }
export interface PersonLlmRecord { id: string; name: string; title?: string | null; linkedin?: string | null; company: string; companyDomain?: string | null }

const LLM_TIMEOUT_MS = Number(process.env.CRAWLER_LLM_TIMEOUT_MS ?? 300_000);
async function llmFetch(path: string, records: unknown[]): Promise<LlmVerifyResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`crawler-service ${path} responded ${res.status}`);
    return (await res.json()) as LlmVerifyResponse;
  } finally {
    clearTimeout(timer);
  }
}

/** DeepSeek cross-check runs in the crawler-service (backend). Throws on transport error. */
export function llmVerifyCompaniesViaCrawler(records: CompanyLlmRecord[]): Promise<LlmVerifyResponse> {
  return llmFetch("/llm/verify-companies", records);
}
export function llmVerifyPeopleViaCrawler(records: PersonLlmRecord[]): Promise<LlmVerifyResponse> {
  return llmFetch("/llm/verify-people", records);
}

/* --------------------------- proxy config (pool) ------------------------- */

async function proxyFetch(path: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`crawler-service ${path} responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** The crawler-service proxy pool config (settings + sanitized proxies). */
export function getProxyConfigRemote(): Promise<unknown> {
  return proxyFetch("/proxies");
}
export function setProxyConfigRemote(cfg: unknown): Promise<unknown> {
  return proxyFetch("/proxies", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
}
export function testProxiesRemote(id?: string): Promise<unknown> {
  return proxyFetch("/proxies/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { id } : {}) });
}

/** Reachability probe for the crawler service. */
export async function pingCrawler(): Promise<{ online: boolean; url: string; provider?: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${BASE}/health`, { signal: controller.signal, cache: "no-store" });
    const j = res.ok ? ((await res.json()) as { searchProvider?: string }) : null;
    return { online: res.ok, url: BASE, provider: j?.searchProvider };
  } catch (err) {
    return { online: false, url: BASE, error: err instanceof Error ? err.message : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

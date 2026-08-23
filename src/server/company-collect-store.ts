/**
 * Server-side store for company multi-source collection jobs (Find Leads →
 * Companies tab import). Persists jobs + collected companies to `.data/collect.json`.
 */
import "server-only";
import fs from "fs";
import path from "path";
import { employeeBucket, type CollectSummary, type CollectedCompany, type CompanyCollectJob, type SourcedField } from "@/lib/leads/collect-types";

export const MAX_COLLECT_COMPANIES = Number(process.env.APP_MAX_COLLECT_COMPANIES ?? 200);

interface CollectStoreData {
  jobs: CompanyCollectJob[];
  companies: Record<string, CollectedCompany[]>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "collect.json");

declare global {
  // eslint-disable-next-line no-var
  var __collectStore: CollectStoreData | undefined;
}

function load(): CollectStoreData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (parsed && Array.isArray(parsed.jobs) && parsed.companies) return parsed as CollectStoreData;
    }
  } catch { /* start empty */ }
  const empty: CollectStoreData = { jobs: [], companies: {} };
  persist(empty);
  return empty;
}

function store(): CollectStoreData {
  if (!globalThis.__collectStore) globalThis.__collectStore = load();
  return globalThis.__collectStore;
}

let saveTimer: NodeJS.Timeout | null = null;
function persist(d: CollectStoreData) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(d));
  } catch { /* best-effort */ }
}
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; persist(store()); }, 1200);
}

function emptySummary(total: number): CollectSummary {
  return { total, enriched: 0, resolved: 0, withWebsite: 0, withEmail: 0, withPhone: 0, withLinkedin: 0, withLegalEntity: 0, cacheHits: 0, rateLimited: 0, proxyRotations: 0, emailsVerified: 0, emailsValid: 0 };
}

/* -------------------------------- reads ---------------------------------- */

export function listCollectJobs(): CompanyCollectJob[] {
  return store().jobs.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}
export function getCollectJob(id: string): CompanyCollectJob | undefined {
  return store().jobs.find((j) => j.id === id);
}
export function rawCompanies(jobId: string): CollectedCompany[] {
  return store().companies[jobId] ?? [];
}

/** Companies in a job by id (preserves the given id order). */
export function companiesByIds(jobId: string, ids: string[]): CollectedCompany[] {
  const list = store().companies[jobId] ?? [];
  const byId = new Map(list.map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter((c): c is CollectedCompany => !!c);
}

export interface CompaniesQuery {
  page?: number; pageSize?: number; search?: string;
  company?: string[]; // company-name contains  (OR)
  locations?: string[]; // location contains  (OR)
  employees?: string[]; // size buckets  (OR)
  industries?: string[]; // OR
  technologies?: string[]; // tech stack contains  (OR)
  status?: string[]; // enriched | not_found
  has?: string[]; // website | email | phone | linkedin  (AND — all required)
  email?: string[]; // valid | bad  (OR)
}
export interface CompaniesFacets {
  status: Record<string, number>;
  has: { website: number; email: number; phone: number; linkedin: number };
  email: { valid: number; bad: number };
  industries: { name: string; count: number }[];
  technologies: { name: string; count: number }[];
  employees: Record<string, number>;
}
export interface CompaniesPage { companies: CollectedCompany[]; total: number; page: number; pageSize: number; facets: CompaniesFacets }

const isBadEmailCo = (c: CollectedCompany) => c.emailVerification != null && ["invalid", "disposable"].includes(c.emailVerification.status);

function companiesFacets(all: CollectedCompany[]): CompaniesFacets {
  const status: Record<string, number> = {};
  const has = { website: 0, email: 0, phone: 0, linkedin: 0 };
  const email = { valid: 0, bad: 0 };
  const employees: Record<string, number> = {};
  const industryCounts = new Map<string, number>();
  const techCounts = new Map<string, number>();
  for (const c of all) {
    status[c.status] = (status[c.status] ?? 0) + 1;
    if (c.website) has.website++;
    if (c.contactEmail) has.email++;
    if (c.phone) has.phone++;
    if (c.linkedin) has.linkedin++;
    if (c.emailVerification?.status === "valid") email.valid++;
    if (isBadEmailCo(c)) email.bad++;
    const eb = employeeBucket(c.employees?.value);
    if (eb) employees[eb] = (employees[eb] ?? 0) + 1;
    const ind = c.industry?.value ? String(c.industry.value) : "";
    if (ind) industryCounts.set(ind, (industryCounts.get(ind) ?? 0) + 1);
    for (const t of c.technologies?.value ?? []) {
      const name = String(t).trim();
      if (name) techCounts.set(name, (techCounts.get(name) ?? 0) + 1);
    }
  }
  const byCountDesc = (a: { count: number }, b: { count: number }) => b.count - a.count;
  const industries = [...industryCounts.entries()].map(([name, count]) => ({ name, count })).sort(byCountDesc).slice(0, 40);
  const technologies = [...techCounts.entries()].map(([name, count]) => ({ name, count })).sort(byCountDesc).slice(0, 40);
  return { status, has, email, industries, technologies, employees };
}

export function getCompanies(jobId: string, query: CompaniesQuery = {}): CompaniesPage {
  const all = store().companies[jobId] ?? [];
  const {
    page = 1, pageSize = 25, search = "",
    company = [], locations = [], employees = [], industries = [], technologies = [],
    status = [], has = [], email = [],
  } = query;
  const facets = companiesFacets(all);

  const lower = (arr: string[]) => arr.map((s) => s.toLowerCase());
  const companyTerms = lower(company);
  const locationTerms = lower(locations);
  const techTerms = lower(technologies);

  const companyLocation = (c: CollectedCompany) =>
    (c.address?.value ? String(c.address.value) : c.inputLocation).toLowerCase();

  let filtered = all;
  const q = search.trim().toLowerCase();
  if (q) filtered = filtered.filter((c) => c.inputName.toLowerCase().includes(q) || c.inputLocation.toLowerCase().includes(q) || (c.domainGuess ?? "").includes(q));
  if (companyTerms.length) filtered = filtered.filter((c) => { const n = c.inputName.toLowerCase(); return companyTerms.some((t) => n.includes(t)); });
  if (locationTerms.length) filtered = filtered.filter((c) => { const loc = companyLocation(c); return locationTerms.some((t) => loc.includes(t)); });
  if (employees.length) filtered = filtered.filter((c) => { const b = employeeBucket(c.employees?.value); return b != null && employees.includes(b); });
  if (industries.length) filtered = filtered.filter((c) => c.industry?.value != null && industries.includes(String(c.industry.value)));
  if (techTerms.length) filtered = filtered.filter((c) => { const techs = (c.technologies?.value ?? []).map((x) => String(x).toLowerCase()); return techTerms.some((t) => techs.includes(t)); });
  if (status.length) filtered = filtered.filter((c) => status.includes(c.status));
  if (has.length) filtered = filtered.filter((c) => has.every((h) =>
    h === "website" ? !!c.website : h === "email" ? !!c.contactEmail : h === "phone" ? !!c.phone : h === "linkedin" ? !!c.linkedin : true));
  if (email.length) filtered = filtered.filter((c) => email.some((e) =>
    e === "valid" ? c.emailVerification?.status === "valid" : e === "bad" ? isBadEmailCo(c) : false));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  return { companies: filtered.slice(start, start + pageSize), total, page, pageSize, facets };
}

/* ------------------------------- mutations ------------------------------- */

export interface CreateCollectInput {
  name: string;
  fileName: string;
  rows: { company: string; location: string }[];
}

export function createCollectJob(input: CreateCollectInput): { job: CompanyCollectJob; truncated: number } {
  const seen = new Set<string>();
  const unique = input.rows
    .map((r) => ({ company: r.company.trim(), location: r.location.trim() }))
    .filter((r) => {
      if (!r.company) return false;
      const key = `${r.company.toLowerCase()}|${r.location.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const capped = unique.slice(0, MAX_COLLECT_COMPANIES);
  const truncated = unique.length - capped.length;

  const id = `col_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const now = new Date().toISOString();
  const job: CompanyCollectJob = {
    id, name: input.name, fileName: input.fileName, status: "collecting", verifyStatus: "idle",
    total: capped.length, progress: 0, summary: emptySummary(capped.length), createdAt: now,
  };
  const s = store();
  s.companies[id] = capped.map((r, i) => blankCompany(`${id}_${i}`, id, r.company, r.location));
  s.jobs.push(job);
  scheduleSave();
  return { job, truncated };
}

function blankCompany(id: string, jobId: string, name: string, location: string): CollectedCompany {
  return {
    id, jobId, inputName: name, inputLocation: location, domainGuess: "", logoText: "", status: "pending",
    resolution: null,
    website: null, emailDomain: null, contactEmail: null, phone: null, linkedin: null, twitter: null, facebook: null,
    address: null, mapsRating: null, industry: null, employees: null, revenue: null, founded: null, description: null,
    technologies: null, legalName: null, jurisdiction: null, registrationNumber: null, incorporated: null,
    emailVerification: null, collection: [],
  };
}

export function setCompanyCollecting(jobId: string, companyId: string) {
  const c = store().companies[jobId]?.find((x) => x.id === companyId);
  if (c) c.status = "collecting";
}

export function applyCompany(jobId: string, companyId: string, patch: Omit<CollectedCompany, "id" | "jobId">) {
  const list = store().companies[jobId];
  if (!list) return;
  const idx = list.findIndex((c) => c.id === companyId);
  if (idx === -1) return;
  list[idx] = { ...patch, id: companyId, jobId };
  recompute(jobId);
  scheduleSave();
}

export function setJobVerifyStatus(jobId: string, verifyStatus: CompanyCollectJob["verifyStatus"]) {
  const job = getCollectJob(jobId);
  if (!job) return;
  job.verifyStatus = verifyStatus;
  scheduleSave();
}

/**
 * Contact emails worth verifying: only REAL, website-sourced addresses (the
 * simulated `info@` from the directory source is mock and not worth a check).
 * Pass `onlyUnverified` to skip ones already checked.
 */
export function emailTargets(jobId: string, onlyUnverified = true): { companyId: string; email: string }[] {
  const list = store().companies[jobId] ?? [];
  const out: { companyId: string; email: string }[] = [];
  for (const c of list) {
    const f = c.contactEmail;
    if (!f || f.source !== "website") continue;
    if (onlyUnverified && c.emailVerification) continue;
    out.push({ companyId: c.id, email: String(f.value) });
  }
  return out;
}

export function setCompanyVerification(jobId: string, companyId: string, ev: CollectedCompany["emailVerification"]) {
  const c = store().companies[jobId]?.find((x) => x.id === companyId);
  if (!c) return;
  c.emailVerification = ev;
}

/** Companies worth an LLM cross-check.
 *  Token-saving rule: ONLY uncertain / low-score rows. Auto-accepted high-
 *  confidence matches (website + LinkedIn + score ≥ bar) skip the LLM.
 *  Override bar with LLM_VERIFY_MAX_CONFIDENCE (default 85). */
const COMPANY_LLM_MAX_CONF = Number(process.env.LLM_VERIFY_MAX_CONFIDENCE ?? 85);

function companyNeedsLlm(c: CollectedCompany): boolean {
  const conf = c.resolution?.confidence ?? 0;
  const hasWeb = !!c.website?.value || !!c.domainGuess;
  const hasLi = !!c.linkedin?.value;
  const strong = conf >= COMPANY_LLM_MAX_CONF && hasWeb && hasLi;
  return !strong;
}

export function llmTargets(jobId: string, onlyUnverified = true): CollectedCompany[] {
  return (store().companies[jobId] ?? []).filter((c) => {
    if (c.status !== "enriched") return false;
    if (onlyUnverified && c.llmVerification) return false;
    return companyNeedsLlm(c);
  });
}

/** High-confidence companies skipped to save tokens. */
export function llmSkippedCount(jobId: string, onlyUnverified = true): number {
  return (store().companies[jobId] ?? []).filter((c) => {
    if (c.status !== "enriched") return false;
    if (onlyUnverified && c.llmVerification) return false;
    return !companyNeedsLlm(c);
  }).length;
}
export function setCompanyLlm(jobId: string, companyId: string, v: CollectedCompany["llmVerification"]) {
  const c = store().companies[jobId]?.find((x) => x.id === companyId);
  if (c) c.llmVerification = v;
}

/* ------------------- LLM knowledge-based enrichment ---------------------- */

/** Rows the crawler could not resolve — candidates for a DeepSeek knowledge
 *  fill. `onlyUnattempted` skips rows already tried by the LLM (token-saving). */
export function llmEnrichTargets(jobId: string, onlyUnattempted = true): CollectedCompany[] {
  return (store().companies[jobId] ?? []).filter((c) => {
    if (c.status !== "failed" && c.status !== "not_found") return false;
    if (onlyUnattempted && c.llmVerification) return false;
    return true;
  });
}

export interface LlmEnrichmentInput {
  id: string;
  found: boolean;
  confidence: number;
  website?: string | null;
  linkedin?: string | null;
  industry?: string | null;
  location?: string | null;
  employees?: string | null;
  description?: string | null;
  founded?: number | null;
}

/**
 * Apply one DeepSeek knowledge-fill to a failed/not-found row. When the model
 * knew the company, fields are written with source "llm" and the row is
 * promoted to "enriched"; otherwise only an AI verdict is recorded so the row
 * is not retried on the next click. Returns whether the row was filled.
 */
export function applyLlmEnrichment(jobId: string, e: LlmEnrichmentInput, model: string, at: string): boolean {
  const c = store().companies[jobId]?.find((x) => x.id === e.id);
  if (!c) return false;
  const conf = Math.max(0, Math.min(100, Math.round(e.confidence)));
  const mk = <T,>(value: T | null | undefined): SourcedField<T> | null =>
    value == null || value === "" ? null : { value, source: "llm", confidence: conf };

  const filled = e.found && !!(e.website || e.linkedin || e.industry || e.employees || e.description || e.founded);
  if (filled) {
    if (e.website) { const w = mk(e.website); if (w) { c.website = w; c.domainGuess = String(e.website); c.emailDomain = c.emailDomain ?? w; } }
    if (e.linkedin) c.linkedin = mk(e.linkedin) ?? c.linkedin;
    if (e.industry) c.industry = mk(e.industry) ?? c.industry;
    if (e.location) c.address = mk(e.location) ?? c.address;
    if (e.employees) c.employees = mk(e.employees) ?? c.employees;
    if (e.description) c.description = mk(e.description) ?? c.description;
    if (e.founded) c.founded = mk(e.founded) ?? c.founded;
    if (!c.logoText) c.logoText = c.inputName.slice(0, 2).toUpperCase();
    c.status = "enriched";
    c.resolution = {
      website: e.website ?? null,
      linkedin: e.linkedin ?? null,
      confidence: conf,
      provider: "deepseek",
      query: `AI knowledge fill · ${c.inputName}`,
      cacheHit: false,
    };
    c.collection = [
      ...c.collection,
      { source: "llm", status: "ok", proxy: null, ms: 0, fieldsFound: 1, detail: `AI enrichment (${model})`, simulated: false },
    ];
  }
  c.llmVerification = {
    status: filled ? "verified" : "uncertain",
    confidence: conf,
    reason: filled ? "Filled from AI knowledge (crawl found nothing)." : "AI has no reliable public data for this company.",
    model,
    verifiedAt: at,
  };
  return filled;
}
export function commitLlm(jobId: string) {
  void jobId;
  persist(store());
}

/** Recompute summary + persist after a batch of verification updates. */
export function commitVerification(jobId: string) {
  recompute(jobId);
  persist(store());
}

export function finalizeCollectJob(jobId: string) {
  const job = getCollectJob(jobId);
  if (!job) return;
  recompute(jobId);
  job.progress = 100;
  job.status = "completed";
  job.completedAt = new Date().toISOString();
  persist(store());
}

function recompute(jobId: string) {
  const job = getCollectJob(jobId);
  const list = store().companies[jobId];
  if (!job || !list) return;
  const s = emptySummary(list.length);
  let done = 0;
  for (const c of list) {
    if (c.status !== "pending" && c.status !== "collecting") done++;
    if (c.status === "enriched") s.enriched++;
    if (c.resolution?.website || c.resolution?.linkedin) s.resolved++;
    if (c.website) s.withWebsite++;
    if (c.contactEmail) s.withEmail++;
    if (c.phone) s.withPhone++;
    if (c.linkedin) s.withLinkedin++;
    if (c.legalName || c.registrationNumber) s.withLegalEntity++;
    if (c.resolution?.cacheHit || c.collection.some((a) => a.cacheHit)) s.cacheHits++;
    if (c.emailVerification) { s.emailsVerified++; if (c.emailVerification.status === "valid") s.emailsValid++; }
    for (const a of c.collection) {
      if (a.status === "rate_limited" || a.status === "retried") s.rateLimited++;
      if (a.status === "retried") s.proxyRotations++;
    }
  }
  job.summary = s;
  job.progress = list.length ? Math.round((done / list.length) * 100) : 100;
  if (done >= list.length && job.status === "collecting") { job.status = "completed"; job.completedAt = new Date().toISOString(); }
}

export function deleteCollectJob(id: string): boolean {
  const s = store();
  const before = s.jobs.length;
  s.jobs = s.jobs.filter((j) => j.id !== id);
  delete s.companies[id];
  if (s.jobs.length < before) { persist(s); return true; }
  return false;
}

/** Reset failed rows to pending so the collect job can retry them. */
export function resetFailedCompanies(jobId: string): number {
  const list = store().companies[jobId];
  if (!list) return 0;
  let n = 0;
  for (const c of list) {
    if (c.status === "failed") {
      c.status = "pending";
      n++;
    }
  }
  const job = getCollectJob(jobId);
  if (job && n > 0) {
    job.status = "collecting";
    job.completedAt = undefined;
    persist(store());
  }
  return n;
}

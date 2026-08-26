/**
 * Server-side store for people-collection jobs (Find Leads → "Find people").
 * A job seeds from resolved companies; each company is crawled for its
 * decision-makers, which accumulate as CollectedPerson rows. Persisted to
 * `.data/people.json`. Mirrors company-collect-store.
 */
import "server-only";
import fs from "fs";
import path from "path";
import { initials } from "@/lib/utils";
import { employeeBucket } from "@/lib/leads/collect-types";
import { personHasFunding } from "@/lib/leads/people-types";
import type { CrawledPerson } from "./crawler-client";
import type {
  CollectedPerson,
  PeopleCollectJob,
  PeopleSeedInput,
  PeopleSummary,
  PersonSeniority,
} from "@/lib/leads/people-types";

/** Map a raw CSV seniority / title into the app's PersonSeniority bucket. */
function normalizeSeniority(raw?: string | null, title?: string | null): PersonSeniority | null {
  const t = ` ${`${raw ?? ""} ${title ?? ""}`.toLowerCase()} `;
  if (!t.trim()) return null;
  if (/\b(founder|co-?founder|owner)\b/.test(t)) return "founder";
  if (/\b(c_?suite|chief|ceo|cto|cfo|coo|cmo|cio|cpo|ciso|cdo|managing director|\bmd\b)\b/.test(t)) return "c_level";
  if (/\bpresident\b/.test(t)) return "president";
  if (/\b(vice[- ]president|\bvp\b|svp|evp|head|director)\b/.test(t)) return "vp";
  return "other";
}

/** Bare registrable domain from a website URL ("http://www.acme.com/x" → "acme.com"). */
function domainOf(website?: string | null): string | null {
  if (!website) return null;
  const h = website.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").trim().toLowerCase();
  return h && h.includes(".") ? h : null;
}

export const MAX_PEOPLE_SEEDS = Number(process.env.APP_MAX_PEOPLE_SEEDS ?? 100000);
// Find Leads tabs cache only the N most-recent runs so `.data/*.json` can't grow unbounded.
export const FIND_LEADS_HISTORY_LIMIT = Number(process.env.APP_FIND_LEADS_HISTORY ?? 3);

/** A company seed the job iterates over (also drives progress). */
interface PeopleSeed extends PeopleSeedInput {
  status: "pending" | "collecting" | "done" | "failed";
  peopleFound: number;
  llmEnriched?: boolean; // AI exec-fill fallback already attempted for this seed
}

interface PeopleStoreData {
  jobs: PeopleCollectJob[];
  seeds: Record<string, PeopleSeed[]>;
  people: Record<string, CollectedPerson[]>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "people.json");

declare global {
  // eslint-disable-next-line no-var
  var __peopleStore: PeopleStoreData | undefined;
}

function load(): PeopleStoreData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (parsed && Array.isArray(parsed.jobs) && parsed.seeds && parsed.people) {
        const data = parsed as PeopleStoreData;
        if (data.jobs.length > FIND_LEADS_HISTORY_LIMIT) { pruneHistory(data); persist(data); }
        return data;
      }
    }
  } catch { /* start empty */ }
  const empty: PeopleStoreData = { jobs: [], seeds: {}, people: {} };
  persist(empty);
  return empty;
}

function store(): PeopleStoreData {
  if (!globalThis.__peopleStore) globalThis.__peopleStore = load();
  return globalThis.__peopleStore;
}

let saveTimer: NodeJS.Timeout | null = null;
function persist(d: PeopleStoreData) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(d));
  } catch { /* best-effort */ }
}
/** Keep only the N most-recent jobs (by createdAt); drop older jobs + their seeds/people. */
function pruneHistory(s: PeopleStoreData) {
  if (s.jobs.length <= FIND_LEADS_HISTORY_LIMIT) return;
  const keep = new Set(
    s.jobs.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, FIND_LEADS_HISTORY_LIMIT).map((j) => j.id),
  );
  s.jobs = s.jobs.filter((j) => keep.has(j.id));
  for (const id of Object.keys(s.seeds)) if (!keep.has(id)) delete s.seeds[id];
  for (const id of Object.keys(s.people)) if (!keep.has(id)) delete s.people[id];
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; persist(store()); }, 1200);
}

function emptySummary(companies: number): PeopleSummary {
  return { companies, companiesWithPeople: 0, rowsWithPeople: 0, people: 0, founders: 0, cLevel: 0, vps: 0, withEmail: 0, withLinkedin: 0, emailsVerified: 0, emailsValid: 0 };
}

/* -------------------------------- reads ---------------------------------- */

export function listPeopleJobs(): PeopleCollectJob[] {
  return store().jobs.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}
export function getPeopleJob(id: string): PeopleCollectJob | undefined {
  return store().jobs.find((j) => j.id === id);
}
export function rawSeeds(jobId: string): PeopleSeed[] {
  return store().seeds[jobId] ?? [];
}

/** Per-company breakdown for the People tab: how many people each seed yielded. */
export function getSeedCoverage(jobId: string): { company: string; status: string; peopleFound: number }[] {
  return (store().seeds[jobId] ?? []).map((s) => ({ company: s.company, status: s.status, peopleFound: s.peopleFound }));
}

export interface PeopleQuery {
  page?: number; pageSize?: number; search?: string;
  ids?: string[]; // restrict to these person ids (AI Support "filter tagged rows")
  email?: string[]; // has | valid | catch_all | risky | invalid | unverified | none
  titles?: string[]; // title contains  (OR)
  seniority?: string[]; // founder | c_level | president | vp | other
  linkedin?: boolean; // must have a LinkedIn URL
  funded?: boolean; // employer has a real funding figure
  companies?: string[]; // filter to these company names
  locations?: string[]; // person location contains  (OR)
  employees?: string[]; // employer size buckets  (OR)
  industries?: string[]; // employer industry  (OR)
  minScore?: number; // minimum match confidence 0-100
  sort?: string; // "company" | "company_desc" (default: insertion order)
}
export interface PeopleFacets {
  seniority: Record<string, number>;
  email: { has: number; valid: number; catch_all: number; risky: number; invalid: number; unverified: number; none: number };
  linkedin: { has: number };
  funded: { has: number };
  companies: { name: string; count: number }[];
  industries: { name: string; count: number }[];
  employees: Record<string, number>;
}
export interface PeoplePage {
  people: CollectedPerson[];
  total: number;
  page: number;
  pageSize: number;
  facets: PeopleFacets;
  verifyingPersonIds: string[];
}

/**
 * The one true email-status bucket for a person, mutually exclusive, matching
 * the real verification statuses so the filter/facets never mislabel a row:
 *   none        — no email at all (or the finder returned not_found)
 *   unverified  — has an email (imported/guessed) that was never checked
 *   valid       — SMTP-confirmed deliverable
 *   catch_all   — domain accepts everything; deliverability can't be confirmed
 *   risky       — risky / unknown / role address
 *   invalid     — invalid or disposable
 */
export type EmailStatusBucket = "none" | "unverified" | "valid" | "catch_all" | "risky" | "invalid";
export function emailStatusBucket(p: CollectedPerson): EmailStatusBucket {
  if (!p.email) return "none";
  const s = p.emailVerification?.status;
  if (!s) return "unverified";
  if (s === "valid") return "valid";
  if (s === "catch_all") return "catch_all";
  if (s === "invalid" || s === "disposable") return "invalid";
  if (s === "not_found") return "none";
  return "risky"; // risky | unknown | role
}

function peopleFacets(all: CollectedPerson[]): PeopleFacets {
  const seniority: Record<string, number> = {};
  const email = { has: 0, valid: 0, catch_all: 0, risky: 0, invalid: 0, unverified: 0, none: 0 };
  const linkedin = { has: 0 };
  const funded = { has: 0 };
  const employees: Record<string, number> = {};
  const companyCounts = new Map<string, number>();
  const industryCounts = new Map<string, number>();
  for (const p of all) {
    seniority[p.seniority] = (seniority[p.seniority] ?? 0) + 1;
    if (p.email) email.has++;
    email[emailStatusBucket(p)]++;
    if (p.linkedin) linkedin.has++;
    if (personHasFunding(p)) funded.has++;
    companyCounts.set(p.company, (companyCounts.get(p.company) ?? 0) + 1);
    const eb = employeeBucket(p.companyEmployees);
    if (eb) employees[eb] = (employees[eb] ?? 0) + 1;
    const ind = p.companyIndustry ? String(p.companyIndustry).trim() : "";
    if (ind) industryCounts.set(ind, (industryCounts.get(ind) ?? 0) + 1);
  }
  const byCountDesc = (a: { count: number }, b: { count: number }) => b.count - a.count;
  const companies = [...companyCounts.entries()].map(([name, count]) => ({ name, count })).sort(byCountDesc).slice(0, 40);
  const industries = [...industryCounts.entries()].map(([name, count]) => ({ name, count })).sort(byCountDesc).slice(0, 40);
  return { seniority, email, linkedin, funded, companies, industries, employees };
}

export function getPeople(jobId: string, query: PeopleQuery = {}): PeoplePage {
  dedupePeople(jobId); // self-heal any duplicate rows (incl. jobs stored before dedup landed)
  sealMissedEmailLookups(jobId);
  const all = store().people[jobId] ?? [];
  const {
    page = 1, pageSize = 25, search = "", ids = [],
    email = [], titles = [], seniority = [], linkedin = false, funded = false,
    companies = [], locations = [], employees = [], industries = [], minScore = 0, sort = "",
  } = query;
  const facets = peopleFacets(all);

  const lower = (arr: string[]) => arr.map((s) => s.toLowerCase());
  const titleTerms = lower(titles);
  const locationTerms = lower(locations);

  let filtered = all;
  // AI Support "filter tagged rows": restrict to an explicit id whitelist first.
  if (ids.length) { const idSet = new Set(ids); filtered = filtered.filter((p) => idSet.has(p.id)); }
  const q = search.trim().toLowerCase();
  if (q) filtered = filtered.filter((p) =>
    p.name.toLowerCase().includes(q) ||
    p.company.toLowerCase().includes(q) ||
    (p.title?.value ? String(p.title.value).toLowerCase().includes(q) : false));
  if (email.length) filtered = filtered.filter((p) => {
    const b = emailStatusBucket(p);
    return email.some((e) => (e === "has" ? !!p.email : e === "bad" ? b === "invalid" : e === b));
  });
  if (titleTerms.length) filtered = filtered.filter((p) => { const t = (p.title?.value ? String(p.title.value) : "").toLowerCase(); return titleTerms.some((x) => t.includes(x)); });
  if (seniority.length) filtered = filtered.filter((p) => seniority.includes(p.seniority));
  if (linkedin) filtered = filtered.filter((p) => !!p.linkedin);
  if (funded) filtered = filtered.filter((p) => personHasFunding(p));
  if (companies.length) filtered = filtered.filter((p) => companies.includes(p.company));
  if (locationTerms.length) filtered = filtered.filter((p) => { const loc = (p.location ?? "").toLowerCase(); return locationTerms.some((x) => loc.includes(x)); });
  if (employees.length) filtered = filtered.filter((p) => { const b = employeeBucket(p.companyEmployees); return b != null && employees.includes(b); });
  if (industries.length) filtered = filtered.filter((p) => p.companyIndustry != null && industries.includes(String(p.companyIndustry)));
  if (minScore > 0) filtered = filtered.filter((p) => p.confidence >= minScore);

  if (sort) {
    const desc = sort.endsWith("_desc");
    const field = desc ? sort.slice(0, -"_desc".length) : sort;
    const SENIORITY_RANK: Record<string, number> = { founder: 0, c_level: 1, president: 2, vp: 3, other: 4 };
    // Returns a string or number per row for the chosen column.
    const valueOf = (p: CollectedPerson): string | number => {
      switch (field) {
        case "name": return p.name;
        case "title": return p.title?.value ? String(p.title.value) : "";
        case "email": return p.email?.value ? String(p.email.value) : "";
        case "company": return p.company;
        case "companyEmployees": { const n = parseInt(String(p.companyEmployees ?? "").replace(/[^0-9]/g, ""), 10); return Number.isFinite(n) ? n : NaN; }
        case "companyIndustry": return p.companyIndustry ?? "";
        case "seniority": return SENIORITY_RANK[p.seniority] ?? 99;
        case "companyPhone": return p.companyPhone ?? "";
        case "companyEmail": return p.companyEmail ?? "";
        case "linkedin": return p.linkedin ? 0 : 1; // has-LinkedIn first (asc)
        case "location": return p.location ?? "";
        default: return "";
      }
    };
    const isEmpty = (v: string | number) => v === "" || (typeof v === "number" && Number.isNaN(v));
    filtered = [...filtered].sort((a, b) => {
      const av = valueOf(a), bv = valueOf(b);
      // Blank values always sort to the bottom, regardless of direction.
      if (isEmpty(av) && isEmpty(bv)) return 0;
      if (isEmpty(av)) return 1;
      if (isEmpty(bv)) return -1;
      const base = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
      return desc ? -base : base;
    });
  }

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const job = getPeopleJob(jobId);
  return {
    people: filtered.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    facets,
    verifyingPersonIds: job?.verifyingPersonIds ?? [],
  };
}

/* ------------------------------- mutations ------------------------------- */

export interface CreatePeopleJobInput {
  name: string;
  seeds: PeopleSeedInput[];
}

export function createPeopleJob(input: CreatePeopleJobInput): { job: PeopleCollectJob; truncated: number } {
  const seen = new Set<string>();
  const unique = input.seeds
    .map((s) => ({ ...s, company: s.company.trim(), firstName: s.firstName?.trim(), lastName: s.lastName?.trim(), location: (s.location ?? "").trim() }))
    .filter((s) => {
      if (!s.company) return false;
      // Enrich seeds dedup by person+company; discover seeds by company+location.
      const key = (s.firstName || s.lastName)
        ? `${(s.firstName ?? "").toLowerCase()}|${(s.lastName ?? "").toLowerCase()}|${s.company.toLowerCase()}`
        : `${s.company.toLowerCase()}|${(s.location ?? "").toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const capped = unique.slice(0, MAX_PEOPLE_SEEDS);
  const truncated = unique.length - capped.length;
  const mode = capped.some((s) => s.firstName || s.lastName) ? "enrich" : "discover";

  const id = `ppl_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const now = new Date().toISOString();
  const job: PeopleCollectJob = {
    id, name: input.name, mode, status: "collecting", verifyStatus: "idle",
    verifyingPersonIds: [],
    totalCompanies: capped.length, processedCompanies: 0, progress: 0,
    summary: emptySummary(capped.length), createdAt: now,
  };
  const s = store();
  s.seeds[id] = capped.map((seed) => ({ ...seed, status: "pending", peopleFound: 0 }));
  s.people[id] = [];
  s.jobs.push(job);
  pruneHistory(s);
  scheduleSave();
  return { job, truncated };
}

/** Seed indexes still to crawl. */
export function pendingSeedIndexes(jobId: string): number[] {
  return (store().seeds[jobId] ?? []).map((s, i) => (s.status === "pending" ? i : -1)).filter((i) => i >= 0);
}

export function setSeedCollecting(jobId: string, index: number) {
  const seed = store().seeds[jobId]?.[index];
  if (seed) seed.status = "collecting";
}

/** Attach the people crawled for one seed company and mark it done. */
export function applySeedPeople(jobId: string, index: number, crawled: CrawledPerson[]) {
  const s = store();
  const seed = s.seeds[jobId]?.[index];
  if (!seed) return;
  const list = s.people[jobId] ?? (s.people[jobId] = []);
  crawled.forEach((cp, i) => {
    // Pre-fill from CSV-imported seed fields: the crawl's own finds take
    // precedence (they are fresh/verified); the seed only FILLS what the crawl
    // left empty, so an imported title/LinkedIn/seniority shows immediately.
    const imp = (v: string | null | undefined, confidence: number) =>
      v && String(v).trim() ? { value: String(v).trim().replace(/^https?:\/\//i, "").replace(/\/+$/, ""), source: "other" as const, confidence } : null;
    const title = cp.title ?? imp(seed.title, 70);
    const linkedin = cp.linkedin ?? imp(seed.personLinkedin, 75);
    const email = cp.email ?? imp(seed.email, 55);
    const seniority = cp.seniority && cp.seniority !== "other" ? cp.seniority : (normalizeSeniority(seed.seniority, seed.title ?? title?.value) ?? cp.seniority);
    list.push({
      ...cp,
      title,
      linkedin,
      email,
      // An imported (CSV) email is a real, user-given address — mark it "found"
      // so Find & verify only VERIFIES it (never re-finds/replaces it).
      emailKind: cp.email ? cp.emailKind : seed.email ? "found" : cp.emailKind,
      seniority,
      location: cp.location ?? (seed.location || null),
      companyDomain: cp.companyDomain ?? domainOf(seed.website) ?? (seed.domain || null),
      id: `${jobId}_${index}_${i}`,
      jobId,
      companyId: seed.companyId ?? null,
      companyLogoText: initials(cp.company),
      companyEmployees: seed.companyEmployees ?? cp.companyEmployees ?? null,
      companyIndustry: seed.companyIndustry ?? cp.companyIndustry ?? null,
      companyPhone: seed.companyPhone ?? cp.companyPhone ?? null,
      companyEmail: seed.companyEmail ?? cp.companyEmail ?? null,
      mobile: seed.mobile || null,
      twitter: seed.twitter || null,
      facebook: seed.facebook || null,
      photo: seed.photo || null,
      headline: seed.headline || null,
      department: seed.department || null,
      city: seed.city || null,
      state: seed.state || null,
      country: seed.country || null,
      keywords: seed.keywords || null,
      companyLinkedin: seed.companyLinkedin || null,
      companyRevenue: seed.companyRevenue || null,
      companyFunding: seed.companyFunding || null,
      companyTechnologies: seed.companyTechnologies || null,
      companyFoundedYear: seed.companyFoundedYear || null,
      companySeoDescription: seed.companySeoDescription || null,
      companyShortDescription: seed.companyShortDescription || null,
    });
  });
  seed.status = "done";
  seed.peopleFound = crawled.length;
  s.people[jobId] = dedupePeopleList(s.people[jobId] ?? []);
  recompute(jobId);
  scheduleSave();
}

/**
 * Attach a person straight from a saved-list snapshot (import dedup) and mark the
 * seed done. The snapshot is the full CollectedPerson we stored earlier, so every
 * field — title, LinkedIn, email + its verification, confidence — is preserved
 * as-is; no crawl, no re-verify. Re-ids the row to this job.
 */
export function applyPrefillPerson(jobId: string, index: number, snapshot: CollectedPerson) {
  const s = store();
  const seed = s.seeds[jobId]?.[index];
  if (!seed) return;
  const list = s.people[jobId] ?? (s.people[jobId] = []);
  list.push({
    ...snapshot,
    id: `${jobId}_${index}_0`,
    jobId,
    companyId: seed.companyId ?? snapshot.companyId ?? null,
    companyLogoText: initials(snapshot.company || seed.company),
    collection: [
      ...(snapshot.collection ?? []),
      { source: "other", status: "ok", proxy: null, ms: 0, fieldsFound: 1, detail: "imported from saved list, not re-enriched", provider: "import" },
    ],
  });
  seed.status = "done";
  seed.peopleFound = 1;
  s.people[jobId] = dedupePeopleList(s.people[jobId] ?? []);
  recompute(jobId);
  scheduleSave();
}

export function failSeed(jobId: string, index: number) {
  const seed = store().seeds[jobId]?.[index];
  if (seed) { seed.status = "failed"; seed.peopleFound = 0; }
  recompute(jobId);
  scheduleSave();
}

export function setJobVerifyStatus(jobId: string, verifyStatus: PeopleCollectJob["verifyStatus"]) {
  const job = getPeopleJob(jobId);
  if (!job) return;
  job.verifyStatus = verifyStatus;
  job.verifyingPersonIds = [];
  scheduleSave();
}

/** Mark / unmark a person as currently in a verify worker. Persists immediately so the table poll can show a spinner on that row. */
export function markPersonVerifying(jobId: string, personId: string, on: boolean) {
  const job = getPeopleJob(jobId);
  if (!job) return;
  const cur = new Set(job.verifyingPersonIds ?? []);
  if (on) cur.add(personId);
  else cur.delete(personId);
  job.verifyingPersonIds = [...cur];
  persist(store());
}

export function setVerifyingPersonIds(jobId: string, ids: string[]) {
  const job = getPeopleJob(jobId);
  if (!job) return;
  job.verifyingPersonIds = ids;
  persist(store());
}

/**
 * A verdict counts as "already checked" (so the incremental pass may skip it)
 * ONLY if it is a real, settled engine result. Two kinds are NOT settled and
 * always get re-checked:
 *   - `provider: "mock"` — fake verdicts from the retired mock verifier (both
 *     false "valid" and false "not_found").
 *   - `status: "unknown"` — the engine couldn't decide (greylisting, timeout,
 *     M365 inconclusive); a retry can resolve it to a real answer.
 */
function isRealVerdict(ev: CollectedPerson["emailVerification"]): boolean {
  return !!ev && (ev.provider as string) !== "mock" && ev.status !== "unknown";
}

/**
 * Emails worth verifying: any person email we have (both pattern-guessed and
 * found — verifying the guess is the whole point). Pass `onlyUnverified` to skip
 * ones already checked (real-engine verdicts only; mock verdicts are re-checked).
 */
export function emailTargets(jobId: string, onlyUnverified = true): { personId: string; email: string }[] {
  const list = store().people[jobId] ?? [];
  const out: { personId: string; email: string }[] = [];
  for (const p of list) {
    if (!p.email) continue;
    if (onlyUnverified && isRealVerdict(p.emailVerification)) continue;
    out.push({ personId: p.id, email: String(p.email.value) });
  }
  return out;
}

export function setPersonVerification(jobId: string, personId: string, ev: CollectedPerson["emailVerification"]) {
  const p = store().people[jobId]?.find((x) => x.id === personId);
  if (p) p.emailVerification = ev;
}

/**
 * Dev/reset utility: clear every person's email-verification verdict so the
 * "Find & verify" pass re-runs from scratch. Scoped to one job, or all jobs when
 * `jobId` is omitted. Returns how many people were reset.
 */
export function resetPeopleVerification(jobId?: string): number {
  const s = store();
  const ids = jobId ? [jobId] : Object.keys(s.people);
  let reset = 0;
  for (const id of ids) {
    for (const p of s.people[id] ?? []) {
      if (p.emailVerification) { p.emailVerification = null; reset++; }
    }
    const job = getPeopleJob(id);
    if (job) {
      job.verifyStatus = "idle";
      job.verifyingPersonIds = [];
    }
    recompute(id); // zeroes emailsVerified / emailsValid in the summary
  }
  persist(s);
  return reset;
}

/**
 * After Find & verify finished, any row still missing a verdict is a confirmed
 * miss — persist `not_found` so Access email never comes back on reload.
 * No-op unless this job already completed a verify pass.
 */
export function sealMissedEmailLookups(jobId: string): number {
  const job = getPeopleJob(jobId);
  if (job?.verifyStatus !== "done") return 0;
  const list = store().people[jobId] ?? [];
  const now = new Date().toISOString();
  let n = 0;
  for (const p of list) {
    if (p.emailVerification) continue;
    p.email = null;
    p.emailKind = "none";
    p.emailVerification = { email: "", status: "not_found", score: 0, provider: "reacher", verifiedAt: now };
    n++;
  }
  if (n) {
    recompute(jobId);
    scheduleSave();
  }
  return n;
}

/**
 * Full context for the finder-backed verify pass: the person's name + a domain
 * (from the resolved company, else parsed from an existing email) so the finder
 * can DISCOVER the real deliverable address — not just re-check the one guess.
 * A person is a target if it has a domain to search OR an email to re-check.
 */
export interface PersonVerifyTarget {
  personId: string;
  name: string;
  company: string;
  firstName: string;
  lastName: string;
  domain: string | null;
  email: string | null;
  emailKind: CollectedPerson["emailKind"];
  title: string | null;
}
function toVerifyTarget(p: CollectedPerson): PersonVerifyTarget {
  let domain = p.companyDomain;
  if (!domain && p.email) domain = String(p.email.value).split("@")[1] || null;
  return {
    personId: p.id,
    name: p.name,
    company: p.company,
    firstName: p.firstName,
    lastName: p.lastName,
    domain,
    email: p.email ? String(p.email.value) : null,
    emailKind: p.emailKind,
    title: p.title?.value ? String(p.title.value) : null,
  };
}

export function peopleVerifyTargets(jobId: string, onlyUnverified = true): PersonVerifyTarget[] {
  const list = store().people[jobId] ?? [];
  const out: PersonVerifyTarget[] = [];
  for (const p of list) {
    if (onlyUnverified && isRealVerdict(p.emailVerification)) continue;
    out.push(toVerifyTarget(p));
  }
  return out;
}

/** Build a verify target for ONE person (per-row "Access email" action). */
export function personVerifyTarget(jobId: string, personId: string): PersonVerifyTarget | null {
  const p = store().people[jobId]?.find((x) => x.id === personId);
  return p ? toVerifyTarget(p) : null;
}

/** People worth an LLM founder↔company cross-check.
 *  Token-saving rule: ONLY low-confidence / weak-signal rows. High-confidence
 *  LinkedIn+company matches skip the LLM entirely. Override with LLM_VERIFY_MAX_CONFIDENCE. */
const PEOPLE_LLM_MAX_CONF = Number(process.env.LLM_VERIFY_MAX_CONFIDENCE ?? 80);

function personNeedsLlm(p: CollectedPerson): boolean {
  const strong = !!p.linkedin && p.confidence >= PEOPLE_LLM_MAX_CONF;
  return !strong;
}

export function llmTargets(jobId: string, onlyUnverified = true): CollectedPerson[] {
  return (store().people[jobId] ?? []).filter((p) => {
    if (onlyUnverified && p.llmVerification) return false;
    return personNeedsLlm(p);
  });
}

/** High-confidence people that would have been LLM-checked under the old "check all" policy. */
export function llmSkippedCount(jobId: string, onlyUnverified = true): number {
  return (store().people[jobId] ?? []).filter((p) => {
    if (onlyUnverified && p.llmVerification) return false;
    return !personNeedsLlm(p);
  }).length;
}
/**
 * Coverage-gap company seeds worth an AI exec-fill: discover-mode seeds the
 * crawl finished with ZERO people. `onlyUnattempted` skips seeds already tried
 * by the LLM fill. Returns the seed plus its index (people are keyed by index).
 */
export function peopleEnrichTargets(jobId: string, onlyUnattempted = true): { index: number; seed: PeopleSeed }[] {
  return (store().seeds[jobId] ?? [])
    .map((seed, index) => ({ index, seed }))
    .filter(({ seed }) => {
      if (seed.firstName || seed.lastName) return false; // enrich-mode rows aren't company gaps
      if (seed.status !== "done" && seed.status !== "failed") return false;
      if (seed.peopleFound > 0) return false;
      if (onlyUnattempted && seed.llmEnriched) return false;
      return true;
    });
}

/** Mark a seed's AI exec-fill as attempted (whether or not anyone verified). */
export function markSeedLlmEnriched(jobId: string, index: number) {
  const seed = store().seeds[jobId]?.[index];
  if (seed) seed.llmEnriched = true;
}

/**
 * Append AI-sourced people to a coverage-gap seed (crawl-confirmed when
 * possible, DeepSeek knowledge-fill otherwise). Additive to peopleFound.
 */
export function applyLlmPeople(jobId: string, index: number, verified: CrawledPerson[]) {
  const s = store();
  const seed = s.seeds[jobId]?.[index];
  if (!seed) return;
  const list = s.people[jobId] ?? (s.people[jobId] = []);
  verified.forEach((cp, i) => {
    list.push({
      ...cp,
      id: `${jobId}_${index}_llm_${i}`,
      jobId,
      companyId: seed.companyId ?? null,
      companyLogoText: initials(cp.company),
      companyEmployees: seed.companyEmployees ?? null,
      companyIndustry: seed.companyIndustry ?? null,
      companyPhone: seed.companyPhone ?? null,
      companyEmail: seed.companyEmail ?? null,
    });
  });
  seed.llmEnriched = true;
  seed.peopleFound += verified.length;
  if (verified.length > 0 && seed.status === "failed") seed.status = "done";
  s.people[jobId] = dedupePeopleList(s.people[jobId] ?? []);
  recompute(jobId);
  scheduleSave();
}

export function setPersonLlm(jobId: string, personId: string, v: CollectedPerson["llmVerification"]) {
  const p = store().people[jobId]?.find((x) => x.id === personId);
  if (p) p.llmVerification = v;
}

/**
 * Patch a person's resolved identity fields after an AI-verify correction —
 * re-resolving a mismatched / LinkedIn-less row to the CORRECT live profile (or
 * stripping a confirmed-wrong LinkedIn). Recomputes the summary so the
 * with-LinkedIn / seniority counts stay accurate.
 */
export function updatePersonResolved(
  jobId: string,
  personId: string,
  patch: Partial<Pick<CollectedPerson, "linkedin" | "title" | "seniority" | "confidence" | "email" | "emailKind" | "location" | "emailVerification" | "collection">>,
) {
  const p = store().people[jobId]?.find((x) => x.id === personId);
  if (!p) return;
  Object.assign(p, patch);
  recompute(jobId);
  scheduleSave();
}
export function commitLlm(jobId: string) {
  void jobId;
  persist(store());
}

export function commitVerification(jobId: string) {
  recompute(jobId);
  persist(store());
}

export function finalizePeopleJob(jobId: string) {
  const job = getPeopleJob(jobId);
  if (!job) return;
  recompute(jobId);
  job.progress = 100;
  job.status = "completed";
  job.completedAt = new Date().toISOString();
  persist(store());
}

/**
 * Re-queue the coverage-gap company seeds — discover-mode seeds that finished with
 * ZERO people — back to `pending` so "Retry failed" re-crawls them. Returns how
 * many were queued (0 → nothing to retry). Enrich-mode (per-person) rows are left
 * alone; a genuinely people-less company is the only "gap" a re-crawl can fix.
 */
export function resetGapSeeds(jobId: string): number {
  const s = store();
  const seeds = s.seeds[jobId];
  if (!seeds) return 0;
  let n = 0;
  for (const seed of seeds) {
    const isDiscover = !seed.firstName && !seed.lastName;
    if (isDiscover && (seed.status === "done" || seed.status === "failed") && seed.peopleFound === 0) {
      seed.status = "pending";
      n++;
    }
  }
  const job = getPeopleJob(jobId);
  if (job && n > 0) {
    job.status = "collecting";
    job.completedAt = undefined;
    recompute(jobId);
    persist(s);
  }
  return n;
}

/* ------------------------------ dedup ------------------------------------ */

const normKey = (s: string) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const liSlug = (u: string | null | undefined) => {
  const m = String(u ?? "").match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : "";
};
const SENIORITY_RANK: Record<string, number> = { founder: 5, c_level: 4, president: 3, vp: 2, other: 1 };
const personFieldScore = (p: CollectedPerson) =>
  (p.linkedin ? 1 : 0) + (p.email ? 1 : 0) + (p.title?.value ? 1 : 0) +
  (p.emailVerification?.status === "valid" ? 2 : 0) + (p.location ? 1 : 0);

/** Collapse duplicate rows for the SAME person into one, keeping the most senior /
 *  highest-confidence record and back-filling any fields it is missing. */
function mergePeople(group: CollectedPerson[]): CollectedPerson {
  const sorted = [...group].sort((a, b) =>
    (SENIORITY_RANK[b.seniority] ?? 0) - (SENIORITY_RANK[a.seniority] ?? 0) ||
    b.confidence - a.confidence ||
    personFieldScore(b) - personFieldScore(a));
  const primary = { ...sorted[0] };
  for (const o of sorted.slice(1)) {
    if (!primary.linkedin && o.linkedin) primary.linkedin = o.linkedin;
    if (!primary.email && o.email) { primary.email = o.email; primary.emailKind = o.emailKind; }
    if (!primary.emailVerification && o.emailVerification) primary.emailVerification = o.emailVerification;
    if ((!primary.title || !primary.title.value) && o.title?.value) primary.title = o.title;
    if (!primary.location && o.location) primary.location = o.location;
    if (!primary.companyPhone && o.companyPhone) primary.companyPhone = o.companyPhone;
    if (!primary.companyEmail && o.companyEmail) primary.companyEmail = o.companyEmail;
  }
  return primary;
}

/**
 * De-duplicate a job's people. Group by normalized name + company; within a group,
 * merge into ONE record — UNLESS members carry different non-empty LinkedIn slugs
 * (distinct real profiles → genuinely different people, kept separate). Records
 * with no slug are treated as the same person as the group (the common case: a
 * founder surfaced twice under two titles, e.g. "Co-Founder" + "Chief … Officer").
 */
function dedupePeopleList(list: CollectedPerson[]): CollectedPerson[] {
  const groups = new Map<string, CollectedPerson[]>();
  const order: string[] = [];
  for (const p of list) {
    const key = `${normKey(p.name)}|${normKey(p.company)}`;
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); order.push(key); }
    g.push(p);
  }
  const out: CollectedPerson[] = [];
  for (const key of order) {
    const g = groups.get(key)!;
    if (g.length === 1) { out.push(g[0]); continue; }
    const slugs = new Set(g.map((p) => liSlug(p.linkedin?.value)).filter(Boolean));
    if (slugs.size <= 1) { out.push(mergePeople(g)); continue; }
    // Multiple distinct LinkedIn profiles → different people: merge per slug, and
    // keep any slug-less rows as-is (can't safely attribute them to one profile).
    const bySlug = new Map<string, CollectedPerson[]>();
    for (const p of g) {
      const s = liSlug(p.linkedin?.value);
      if (!s) { out.push(p); continue; }
      const arr = bySlug.get(s); if (arr) arr.push(p); else bySlug.set(s, [p]);
    }
    for (const arr of bySlug.values()) out.push(mergePeople(arr));
  }
  return out;
}

/** Collapse duplicate people in place (job-wide) and refresh the summary. */
export function dedupePeople(jobId: string) {
  const s = store();
  const list = s.people[jobId];
  if (!list) return;
  const deduped = dedupePeopleList(list);
  if (deduped.length !== list.length) {
    s.people[jobId] = deduped;
    recompute(jobId);
    scheduleSave();
  }
}

function recompute(jobId: string) {
  const job = getPeopleJob(jobId);
  const seeds = store().seeds[jobId];
  const people = store().people[jobId] ?? [];
  if (!job || !seeds) return;
  const s = emptySummary(seeds.length);
  const companiesWith = new Set<string>();
  let done = 0;
  let rowsWithPeople = 0;
  for (const seed of seeds) {
    if (seed.status === "done" || seed.status === "failed") done++;
    if ((seed.peopleFound ?? 0) > 0) rowsWithPeople++;
  }
  for (const p of people) {
    s.people++;
    if (p.seniority === "founder") s.founders++;
    if (p.seniority === "c_level") s.cLevel++;
    if (p.seniority === "vp" || p.seniority === "president") s.vps++;
    if (p.email) s.withEmail++;
    if (p.linkedin) s.withLinkedin++;
    if (p.emailVerification && p.emailVerification.status !== "not_found") {
      s.emailsVerified++;
      if (p.emailVerification.status === "valid") s.emailsValid++;
    }
    companiesWith.add(p.companyId ?? p.company);
  }
  s.companiesWithPeople = companiesWith.size;
  s.rowsWithPeople = rowsWithPeople;
  job.summary = s;
  job.processedCompanies = done;
  job.progress = seeds.length ? Math.round((done / seeds.length) * 100) : 100;
  if (done >= seeds.length && job.status === "collecting") { job.status = "completed"; job.completedAt = new Date().toISOString(); }
}

export function deletePeopleJob(id: string): boolean {
  const s = store();
  const before = s.jobs.length;
  s.jobs = s.jobs.filter((j) => j.id !== id);
  delete s.seeds[id];
  delete s.people[id];
  if (s.jobs.length < before) { persist(s); return true; }
  return false;
}

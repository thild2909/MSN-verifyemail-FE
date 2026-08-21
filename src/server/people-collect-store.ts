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
import type { CrawledPerson } from "./crawler-client";
import type {
  CollectedPerson,
  PeopleCollectJob,
  PeopleSeedInput,
  PeopleSummary,
} from "@/lib/leads/people-types";

export const MAX_PEOPLE_SEEDS = Number(process.env.APP_MAX_PEOPLE_SEEDS ?? 200);

/** A company seed the job iterates over (also drives progress). */
interface PeopleSeed extends PeopleSeedInput {
  status: "pending" | "collecting" | "done" | "failed";
  peopleFound: number;
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
      if (parsed && Array.isArray(parsed.jobs) && parsed.seeds && parsed.people) return parsed as PeopleStoreData;
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
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; persist(store()); }, 1200);
}

function emptySummary(companies: number): PeopleSummary {
  return { companies, companiesWithPeople: 0, people: 0, founders: 0, cLevel: 0, vps: 0, withEmail: 0, withLinkedin: 0, emailsVerified: 0, emailsValid: 0 };
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
  seniority?: string[]; // founder | c_level | president | vp | other
  email?: string[]; // has | valid | bad
  linkedin?: boolean; // must have a LinkedIn URL
  companies?: string[]; // filter to these company names
}
export interface PeopleFacets {
  seniority: Record<string, number>;
  email: { has: number; valid: number; bad: number };
  linkedin: { has: number };
  companies: { name: string; count: number }[];
}
export interface PeoplePage { people: CollectedPerson[]; total: number; page: number; pageSize: number; facets: PeopleFacets }

const isBadEmail = (p: CollectedPerson) => p.emailVerification != null && ["invalid", "disposable"].includes(p.emailVerification.status);

function peopleFacets(all: CollectedPerson[]): PeopleFacets {
  const seniority: Record<string, number> = {};
  const email = { has: 0, valid: 0, bad: 0 };
  const linkedin = { has: 0 };
  const companyCounts = new Map<string, number>();
  for (const p of all) {
    seniority[p.seniority] = (seniority[p.seniority] ?? 0) + 1;
    if (p.email) email.has++;
    if (p.emailVerification?.status === "valid") email.valid++;
    if (isBadEmail(p)) email.bad++;
    if (p.linkedin) linkedin.has++;
    companyCounts.set(p.company, (companyCounts.get(p.company) ?? 0) + 1);
  }
  const companies = [...companyCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 40);
  return { seniority, email, linkedin, companies };
}

export function getPeople(jobId: string, query: PeopleQuery = {}): PeoplePage {
  const all = store().people[jobId] ?? [];
  const { page = 1, pageSize = 25, search = "", seniority = [], email = [], linkedin = false, companies = [] } = query;
  const facets = peopleFacets(all);

  let filtered = all;
  const q = search.trim().toLowerCase();
  if (q) filtered = filtered.filter((p) =>
    p.name.toLowerCase().includes(q) ||
    p.company.toLowerCase().includes(q) ||
    (p.title?.value ? String(p.title.value).toLowerCase().includes(q) : false));
  if (seniority.length) filtered = filtered.filter((p) => seniority.includes(p.seniority));
  if (email.length) filtered = filtered.filter((p) => email.some((e) =>
    e === "has" ? !!p.email : e === "valid" ? p.emailVerification?.status === "valid" : e === "bad" ? isBadEmail(p) : false));
  if (linkedin) filtered = filtered.filter((p) => !!p.linkedin);
  if (companies.length) filtered = filtered.filter((p) => companies.includes(p.company));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  return { people: filtered.slice(start, start + pageSize), total, page, pageSize, facets };
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
    totalCompanies: capped.length, processedCompanies: 0, progress: 0,
    summary: emptySummary(capped.length), createdAt: now,
  };
  const s = store();
  s.seeds[id] = capped.map((seed) => ({ ...seed, status: "pending", peopleFound: 0 }));
  s.people[id] = [];
  s.jobs.push(job);
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
    list.push({
      ...cp,
      id: `${jobId}_${index}_${i}`,
      jobId,
      companyId: seed.companyId ?? null,
      companyLogoText: initials(cp.company),
    });
  });
  seed.status = "done";
  seed.peopleFound = crawled.length;
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
  scheduleSave();
}

/**
 * Emails worth verifying: any person email we have (both pattern-guessed and
 * found — verifying the guess is the whole point). Pass `onlyUnverified` to skip
 * ones already checked.
 */
export function emailTargets(jobId: string, onlyUnverified = true): { personId: string; email: string }[] {
  const list = store().people[jobId] ?? [];
  const out: { personId: string; email: string }[] = [];
  for (const p of list) {
    if (!p.email) continue;
    if (onlyUnverified && p.emailVerification) continue;
    out.push({ personId: p.id, email: String(p.email.value) });
  }
  return out;
}

export function setPersonVerification(jobId: string, personId: string, ev: CollectedPerson["emailVerification"]) {
  const p = store().people[jobId]?.find((x) => x.id === personId);
  if (p) p.emailVerification = ev;
}

/** People worth an LLM founder↔company cross-check, skipping already-checked. */
export function llmTargets(jobId: string, onlyUnverified = true): CollectedPerson[] {
  return (store().people[jobId] ?? []).filter((p) => !onlyUnverified || !p.llmVerification);
}
export function setPersonLlm(jobId: string, personId: string, v: CollectedPerson["llmVerification"]) {
  const p = store().people[jobId]?.find((x) => x.id === personId);
  if (p) p.llmVerification = v;
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

function recompute(jobId: string) {
  const job = getPeopleJob(jobId);
  const seeds = store().seeds[jobId];
  const people = store().people[jobId] ?? [];
  if (!job || !seeds) return;
  const s = emptySummary(seeds.length);
  const companiesWith = new Set<string>();
  let done = 0;
  for (const seed of seeds) if (seed.status === "done" || seed.status === "failed") done++;
  for (const p of people) {
    s.people++;
    if (p.seniority === "founder") s.founders++;
    if (p.seniority === "c_level") s.cLevel++;
    if (p.seniority === "vp" || p.seniority === "president") s.vps++;
    if (p.email) s.withEmail++;
    if (p.linkedin) s.withLinkedin++;
    if (p.emailVerification) { s.emailsVerified++; if (p.emailVerification.status === "valid") s.emailsValid++; }
    companiesWith.add(p.companyId ?? p.company);
  }
  s.companiesWithPeople = companiesWith.size;
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

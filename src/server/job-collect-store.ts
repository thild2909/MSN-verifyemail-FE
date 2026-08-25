/**
 * Server-side store for job-search crawls (Find Leads → Jobs tab).
 *
 * A crawl fans out over one or more job boards (sources); each board is one
 * unit of work that appends many roles. Roles are deduped per (source, board
 * id). Persists to `.data/jobsearch.json`. Mirrors company-collect-store.
 */
import "server-only";
import fs from "fs";
import path from "path";
import { initials } from "@/lib/utils";
import {
  JOB_SOURCES,
  emptyJobSummary,
  type CollectedJob,
  type JobCollectJob,
  type JobCrawlParams,
  type JobSearchSummary,
  type JobSource,
  type JobSourceCoverage,
} from "@/lib/leads/job-collect-types";

export const MAX_JOBS_PER_SEARCH = Number(process.env.APP_MAX_JOBS_PER_SEARCH ?? 2000);
// Find Leads tabs cache only the N most-recent runs so `.data/*.json` can't grow unbounded.
export const FIND_LEADS_HISTORY_LIMIT = Number(process.env.APP_FIND_LEADS_HISTORY ?? 3);

interface JobStoreData {
  jobs: JobCollectJob[];
  results: Record<string, CollectedJob[]>;
  coverage: Record<string, JobSourceCoverage[]>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "jobsearch.json");

declare global {
  // eslint-disable-next-line no-var
  var __jobSearchStore: JobStoreData | undefined;
}

function load(): JobStoreData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (parsed && Array.isArray(parsed.jobs) && parsed.results) {
        const data = parsed as JobStoreData;
        if (data.jobs.length > FIND_LEADS_HISTORY_LIMIT) { pruneHistory(data); persist(data); }
        return data;
      }
    }
  } catch { /* start empty */ }
  const empty: JobStoreData = { jobs: [], results: {}, coverage: {} };
  persist(empty);
  return empty;
}

function store(): JobStoreData {
  if (!globalThis.__jobSearchStore) globalThis.__jobSearchStore = load();
  return globalThis.__jobSearchStore;
}

let saveTimer: NodeJS.Timeout | null = null;
function persist(d: JobStoreData) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(d));
  } catch { /* best-effort */ }
}
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; persist(store()); }, 1200);
}

/** Keep only the N most-recent searches (by createdAt); drop older ones + their results/coverage. */
function pruneHistory(s: JobStoreData) {
  if (s.jobs.length <= FIND_LEADS_HISTORY_LIMIT) return;
  const keep = new Set(
    s.jobs.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, FIND_LEADS_HISTORY_LIMIT).map((j) => j.id),
  );
  s.jobs = s.jobs.filter((j) => keep.has(j.id));
  for (const id of Object.keys(s.results)) if (!keep.has(id)) delete s.results[id];
  for (const id of Object.keys(s.coverage)) if (!keep.has(id)) delete s.coverage[id];
}

/* -------------------------------- reads ---------------------------------- */

export function listJobSearches(): JobCollectJob[] {
  return store().jobs.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}
export function getJobSearch(id: string): (JobCollectJob & { coverage: JobSourceCoverage[] }) | undefined {
  const job = store().jobs.find((j) => j.id === id);
  if (!job) return undefined;
  return { ...job, coverage: store().coverage[id] ?? [] };
}
export function rawJobs(jobId: string): CollectedJob[] {
  return store().results[jobId] ?? [];
}

export interface JobsQuery {
  page?: number; pageSize?: number; search?: string;
  sources?: string[]; // source id (OR)
  companies?: string[]; // company-name contains (OR)
  locations?: string[]; // location contains (OR)
  workModes?: string[]; // Remote | Hybrid | On-site (OR, case-insensitive)
  postedWithinDays?: number; // 0 = any
}
export interface JobsFacets {
  sources: Record<string, number>;
  workModes: Record<string, number>;
  companies: { name: string; count: number }[];
}
export interface JobsPage { jobs: CollectedJob[]; total: number; page: number; pageSize: number; facets: JobsFacets }

function jobsFacets(all: CollectedJob[]): JobsFacets {
  const sources: Record<string, number> = {};
  const workModes: Record<string, number> = {};
  const companyCounts = new Map<string, number>();
  for (const j of all) {
    sources[j.source] = (sources[j.source] ?? 0) + 1;
    if (j.workMode) workModes[j.workMode] = (workModes[j.workMode] ?? 0) + 1;
    const name = j.company.trim();
    if (name) companyCounts.set(name, (companyCounts.get(name) ?? 0) + 1);
  }
  const companies = [...companyCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 40);
  return { sources, workModes, companies };
}

export function getJobs(jobId: string, query: JobsQuery = {}): JobsPage {
  const all = store().results[jobId] ?? [];
  const { page = 1, pageSize = 25, search = "", sources = [], companies = [], locations = [], workModes = [], postedWithinDays = 0 } = query;
  const facets = jobsFacets(all);

  const lower = (arr: string[]) => arr.map((s) => s.toLowerCase());
  const companyTerms = lower(companies);
  const locationTerms = lower(locations);
  const workModeTerms = lower(workModes);

  let filtered = all;
  const q = search.trim().toLowerCase();
  if (q) filtered = filtered.filter((j) => j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q) || (j.location ?? "").toLowerCase().includes(q));
  if (sources.length) filtered = filtered.filter((j) => sources.includes(j.source));
  if (companyTerms.length) filtered = filtered.filter((j) => { const n = j.company.toLowerCase(); return companyTerms.some((t) => n.includes(t)); });
  if (locationTerms.length) filtered = filtered.filter((j) => { const loc = (j.location ?? "").toLowerCase(); return locationTerms.some((t) => loc.includes(t)); });
  if (workModeTerms.length) filtered = filtered.filter((j) => !!j.workMode && workModeTerms.includes(j.workMode.toLowerCase()));
  if (postedWithinDays > 0) filtered = filtered.filter((j) => j.postedDaysAgo != null && j.postedDaysAgo <= postedWithinDays);

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  return { jobs: filtered.slice(start, start + pageSize), total, page, pageSize, facets };
}

/* ------------------------------- mutations ------------------------------- */

export interface CreateJobSearchInput {
  name: string;
  sources: JobSource[];
  params: JobCrawlParams;
}

export function createJobSearch(input: CreateJobSearchInput): { job: JobCollectJob } {
  const sources = input.sources.filter((s) => JOB_SOURCES.includes(s));
  const id = `js_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const now = new Date().toISOString();
  const job: JobCollectJob = {
    id, name: input.name, sources, params: input.params, status: "collecting", verifyStatus: "idle",
    progress: 0, summary: emptyJobSummary(sources.length), createdAt: now,
  };
  const s = store();
  s.jobs.push(job);
  s.results[id] = [];
  s.coverage[id] = sources.map((source) => ({ source, status: "pending", jobsFound: 0, pages: 0 }));
  pruneHistory(s);
  scheduleSave();
  return { job };
}

export function setSourceCollecting(jobId: string, source: JobSource) {
  const cov = store().coverage[jobId]?.find((c) => c.source === source);
  if (cov) cov.status = "collecting";
  recompute(jobId);
  scheduleSave();
}

/** Append a source's roles (deduped by externalId within the whole crawl). */
export function appendJobs(
  jobId: string,
  source: JobSource,
  jobs: Array<Omit<CollectedJob, "id" | "jobId" | "companyLogoText">>,
  meta: { pages: number; proxyRotations: number },
) {
  const s = store();
  const list = s.results[jobId];
  if (!list) return;
  const seen = new Set(list.map((j) => `${j.source}:${j.externalId}`));
  let added = 0;
  for (const j of jobs) {
    if (list.length >= MAX_JOBS_PER_SEARCH) break;
    const key = `${source}:${j.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ ...j, id: `${jobId}_${list.length}`, jobId, companyLogoText: initials(j.company) });
    added++;
  }
  const cov = s.coverage[jobId]?.find((c) => c.source === source);
  if (cov) { cov.jobsFound += added; cov.pages += meta.pages; }
  const sum = getJobSearch(jobId)?.summary;
  if (sum) sum.proxyRotations += meta.proxyRotations;
  recompute(jobId);
  scheduleSave();
}

export function finalizeSource(jobId: string, source: JobSource, status: "done" | "blocked" | "failed") {
  const cov = store().coverage[jobId]?.find((c) => c.source === source);
  if (cov) cov.status = status;
  recompute(jobId);
  scheduleSave();
}

export function finalizeJobSearch(jobId: string) {
  const job = getJob(jobId);
  if (!job) return;
  recompute(jobId);
  job.progress = 100;
  job.status = "completed";
  job.completedAt = new Date().toISOString();
  persist(store());
}

function getJob(id: string): JobCollectJob | undefined {
  return store().jobs.find((j) => j.id === id);
}

function recompute(jobId: string) {
  const job = getJob(jobId);
  const list = store().results[jobId];
  const coverage = store().coverage[jobId];
  if (!job || !list || !coverage) return;
  const prevRotations = job.summary.proxyRotations;
  const s: JobSearchSummary = emptyJobSummary(coverage.length);
  s.proxyRotations = prevRotations;
  const companies = new Set<string>();
  for (const j of list) {
    s.jobs++;
    s.bySource[j.source] = (s.bySource[j.source] ?? 0) + 1;
    companies.add(j.company.trim().toLowerCase());
  }
  s.companies = companies.size;
  let done = 0;
  for (const c of coverage) {
    s.pagesCrawled += c.pages;
    if (c.status === "done" || c.status === "blocked" || c.status === "failed") done++;
    if (c.status === "blocked") s.blocked++;
  }
  s.sourcesDone = done;
  job.summary = s;
  job.progress = coverage.length ? Math.round((done / coverage.length) * 100) : 100;
  if (done >= coverage.length && job.status === "collecting") {
    job.status = "completed";
    job.completedAt = new Date().toISOString();
  }
}

/** Reset every blocked/failed source back to "pending" so a retry re-crawls
 *  only those. Their prior partial results/counters are cleared so the fresh
 *  attempt rebuilds them cleanly. Returns the sources queued for retry (an
 *  empty array means there was nothing to retry). */
export function retryBlockedSources(jobId: string): JobSource[] {
  const s = store();
  const job = getJob(jobId);
  const coverage = s.coverage[jobId];
  if (!job || !coverage) return [];
  const retry: JobSource[] = [];
  for (const c of coverage) {
    if (c.status === "blocked" || c.status === "failed") {
      c.status = "pending";
      c.jobsFound = 0;
      c.pages = 0;
      retry.push(c.source);
    }
  }
  if (retry.length === 0) return [];
  const retrySet = new Set<JobSource>(retry);
  s.results[jobId] = (s.results[jobId] ?? []).filter((j) => !retrySet.has(j.source));
  job.status = "collecting";
  job.completedAt = undefined;
  recompute(jobId);
  scheduleSave();
  return retry;
}

export function deleteJobSearch(id: string): boolean {
  const s = store();
  const before = s.jobs.length;
  s.jobs = s.jobs.filter((j) => j.id !== id);
  delete s.results[id];
  delete s.coverage[id];
  if (s.jobs.length < before) { persist(s); return true; }
  return false;
}

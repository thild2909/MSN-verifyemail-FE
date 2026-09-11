/**
 * Server-side store for LinkedIn job scrapes (Find Leads → LinkedIn Jobs tab).
 *
 * A scrape fans out over keyword×location QUERIES; each query appends many
 * roles, deduped by `linkedinJobId`. Rows are normalized + qualified + scored on
 * append (Parse/Normalize/Dedup/Filter/Score). The opt-in enrich pass later
 * fills job-detail + company fields and re-qualifies/re-scores in place.
 * Persists to `.data/linkedin-jobs.json`, keeping only the N most-recent runs.
 */
import "server-only";
import fs from "fs";
import path from "path";
import { initials } from "@/lib/utils";
import {
  emptyLinkedInSummary,
  type CollectedLinkedInJob,
  type LinkedInScrapeParams,
  type LinkedInSearchJob,
  type LinkedInSearchSummary,
  type LinkedInQueryCoverage,
} from "@/lib/leads/linkedin-jobs-types";
import { normalizeLocation, normalizeTitle, postedDaysAgo, qualifyJob, scoreJob } from "@/lib/leads/linkedin-normalize";
import type { LinkedInRawJob, LinkedInJobDetail, LinkedInCompanyInfo } from "./linkedin-jobs-crawler-client";

export const MAX_LINKEDIN_JOBS = Number(process.env.APP_MAX_LINKEDIN_JOBS ?? 3000);
export const FIND_LEADS_HISTORY_LIMIT = Number(process.env.APP_FIND_LEADS_HISTORY ?? 3);

interface StoreData {
  jobs: LinkedInSearchJob[];
  results: Record<string, CollectedLinkedInJob[]>;
  coverage: Record<string, LinkedInQueryCoverage[]>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "linkedin-jobs.json");

declare global {
  // eslint-disable-next-line no-var
  var __linkedinJobsStore: StoreData | undefined;
}

function load(): StoreData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (parsed && Array.isArray(parsed.jobs) && parsed.results) {
        const data = parsed as StoreData;
        if (data.jobs.length > FIND_LEADS_HISTORY_LIMIT) { pruneHistory(data); persist(data); }
        return data;
      }
    }
  } catch { /* start empty */ }
  const empty: StoreData = { jobs: [], results: {}, coverage: {} };
  persist(empty);
  return empty;
}

function store(): StoreData {
  if (!globalThis.__linkedinJobsStore) globalThis.__linkedinJobsStore = load();
  return globalThis.__linkedinJobsStore;
}

let saveTimer: NodeJS.Timeout | null = null;
function persist(d: StoreData) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(d));
  } catch { /* best-effort */ }
}
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; persist(store()); }, 1200);
}

function pruneHistory(s: StoreData) {
  if (s.jobs.length <= FIND_LEADS_HISTORY_LIMIT) return;
  const keep = new Set(
    s.jobs.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, FIND_LEADS_HISTORY_LIMIT).map((j) => j.id),
  );
  s.jobs = s.jobs.filter((j) => keep.has(j.id));
  for (const id of Object.keys(s.results)) if (!keep.has(id)) delete s.results[id];
  for (const id of Object.keys(s.coverage)) if (!keep.has(id)) delete s.coverage[id];
}

function getJob(id: string): LinkedInSearchJob | undefined {
  return store().jobs.find((j) => j.id === id);
}

/* -------------------------------- reads ---------------------------------- */

export function listLinkedInSearches(): LinkedInSearchJob[] {
  return store().jobs.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}
export function getLinkedInSearch(id: string): (LinkedInSearchJob & { coverage: LinkedInQueryCoverage[] }) | undefined {
  const job = getJob(id);
  if (!job) return undefined;
  return { ...job, coverage: store().coverage[id] ?? [] };
}

export interface LinkedInJobsQuery {
  page?: number; pageSize?: number; search?: string;
  roleFamilies?: string[];
  countries?: string[];
  seniorities?: string[];
  remoteOnly?: boolean;
  qualifiedOnly?: boolean;
  minScore?: number;
  postedWithinDays?: number;
}
export interface LinkedInJobsFacets {
  roleFamilies: Record<string, number>;
  countries: Record<string, number>;
  seniorities: Record<string, number>;
  companies: { name: string; count: number }[];
}
export interface LinkedInJobsPage {
  jobs: CollectedLinkedInJob[]; total: number; page: number; pageSize: number; facets: LinkedInJobsFacets;
}

function facetsOf(all: CollectedLinkedInJob[]): LinkedInJobsFacets {
  const roleFamilies: Record<string, number> = {};
  const countries: Record<string, number> = {};
  const seniorities: Record<string, number> = {};
  const companyCounts = new Map<string, number>();
  for (const j of all) {
    if (j.roleFamily) roleFamilies[j.roleFamily] = (roleFamilies[j.roleFamily] ?? 0) + 1;
    if (j.country) countries[j.country] = (countries[j.country] ?? 0) + 1;
    if (j.seniorityLevel) seniorities[j.seniorityLevel] = (seniorities[j.seniorityLevel] ?? 0) + 1;
    const name = j.company.trim();
    if (name && name !== "—") companyCounts.set(name, (companyCounts.get(name) ?? 0) + 1);
  }
  const companies = [...companyCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 40);
  return { roleFamilies, countries, seniorities, companies };
}

export function getLinkedInJobs(jobId: string, query: LinkedInJobsQuery = {}): LinkedInJobsPage {
  const all = store().results[jobId] ?? [];
  const {
    page = 1, pageSize = 25, search = "", roleFamilies = [], countries = [], seniorities = [],
    remoteOnly = false, qualifiedOnly = false, minScore = 0, postedWithinDays = 0,
  } = query;
  const facets = facetsOf(all);

  let filtered = all;
  const q = search.trim().toLowerCase();
  if (q) filtered = filtered.filter((j) => j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q) || (j.location ?? "").toLowerCase().includes(q));
  if (roleFamilies.length) filtered = filtered.filter((j) => !!j.roleFamily && roleFamilies.includes(j.roleFamily));
  if (countries.length) filtered = filtered.filter((j) => !!j.country && countries.includes(j.country));
  if (seniorities.length) filtered = filtered.filter((j) => !!j.seniorityLevel && seniorities.includes(j.seniorityLevel));
  if (remoteOnly) filtered = filtered.filter((j) => j.remote);
  if (qualifiedOnly) filtered = filtered.filter((j) => j.qualified);
  if (minScore > 0) filtered = filtered.filter((j) => j.fitScore >= minScore);
  if (postedWithinDays > 0) filtered = filtered.filter((j) => j.postedDaysAgo != null && j.postedDaysAgo <= postedWithinDays);

  filtered = filtered.slice().sort((a, b) => b.fitScore - a.fitScore);
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  return { jobs: filtered.slice(start, start + pageSize), total, page, pageSize, facets };
}

/* ------------------------------- mutations ------------------------------- */

export interface CreateLinkedInSearchInput { name: string; params: LinkedInScrapeParams; }

/** Expand keywords × locations into one coverage query each. */
function buildCoverage(params: LinkedInScrapeParams): LinkedInQueryCoverage[] {
  const locations = params.locations.length ? params.locations : [""];
  const out: LinkedInQueryCoverage[] = [];
  const seen = new Set<string>();
  for (const keyword of params.keywords) {
    for (const location of locations) {
      const key = `${keyword.toLowerCase()}@${location.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key: `${keyword} @ ${location || "worldwide"}`, keyword, location, status: "pending", jobsFound: 0, pages: 0 });
    }
  }
  return out;
}

export function createLinkedInSearch(input: CreateLinkedInSearchInput): { job: LinkedInSearchJob } {
  const id = `lij_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const now = new Date().toISOString();
  const coverage = buildCoverage(input.params);
  const job: LinkedInSearchJob = {
    id, name: input.name, params: input.params, status: "collecting", enrichStatus: "idle",
    progress: 0, summary: emptyLinkedInSummary(coverage.length), createdAt: now,
  };
  const s = store();
  s.jobs.push(job);
  s.results[id] = [];
  s.coverage[id] = coverage;
  pruneHistory(s);
  scheduleSave();
  return { job };
}

export function setQueryCollecting(jobId: string, key: string) {
  const cov = store().coverage[jobId]?.find((c) => c.key === key);
  if (cov) cov.status = "collecting";
  scheduleSave();
}

/** Append a query's discovered cards: normalize + dedup (linkedinJobId) + qualify + score. */
export function appendLinkedInJobs(jobId: string, key: string, raw: LinkedInRawJob[], meta: { pages: number }) {
  const job = getJob(jobId);
  const list = store().results[jobId];
  if (!job || !list) return;
  const seen = new Set(list.map((j) => j.linkedinJobId));
  const now = new Date().toISOString();
  let added = 0;
  for (const r of raw) {
    if (list.length >= MAX_LINKEDIN_JOBS) break;
    if (!r.linkedinJobId || seen.has(r.linkedinJobId)) continue;
    seen.add(r.linkedinJobId);
    const loc = normalizeLocation(r.location);
    const nt = normalizeTitle(r.title);
    const row: CollectedLinkedInJob = {
      id: `${jobId}_${list.length}`,
      jobId,
      linkedinJobId: r.linkedinJobId,
      jobUrl: r.jobUrl,
      title: r.title,
      company: r.company || "—",
      companyLogoText: initials(r.company || "—"),
      companyLinkedinUrl: r.companyLinkedinUrl,
      location: r.location,
      description: null,
      postedAt: r.postedAt,
      postedText: r.postedText,
      postedDaysAgo: postedDaysAgo(r.postedAt, r.postedText),
      applicants: null,
      employmentType: null,
      seniority: null,
      jobFunction: null,
      industries: [],
      country: loc.country,
      city: loc.city,
      remote: loc.remote,
      roleFamily: nt.roleFamily,
      primaryLanguage: nt.primaryLanguage,
      seniorityLevel: nt.seniorityLevel,
      companyEmployeeRange: null,
      companyEmployeeMin: null,
      companyIndustry: null,
      companyWebsite: null,
      fitScore: 0,
      qualified: false,
      rejectReason: null,
      enriched: false,
      sourceQuery: key,
      discoveredAt: now,
    };
    const gate = qualifyJob(row, job.params, false);
    row.qualified = gate.qualified;
    row.rejectReason = gate.rejectReason;
    row.fitScore = scoreJob(row, job.params);
    list.push(row);
    added++;
  }
  const cov = store().coverage[jobId]?.find((c) => c.key === key);
  if (cov) { cov.jobsFound += added; cov.pages += meta.pages; }
  recompute(jobId);
  scheduleSave();
}

export function finalizeQuery(jobId: string, key: string, status: "done" | "blocked" | "failed", error?: string) {
  const cov = store().coverage[jobId]?.find((c) => c.key === key);
  if (cov) { cov.status = status; cov.error = error || undefined; }
  recompute(jobId);
  scheduleSave();
}

export function finalizeLinkedInSearch(jobId: string) {
  const job = getJob(jobId);
  if (!job) return;
  recompute(jobId);
  job.progress = 100;
  job.status = "completed";
  job.completedAt = new Date().toISOString();
  persist(store());
}

function recompute(jobId: string) {
  const job = getJob(jobId);
  const list = store().results[jobId];
  const coverage = store().coverage[jobId];
  if (!job || !list || !coverage) return;
  const s: LinkedInSearchSummary = emptyLinkedInSummary(coverage.length);
  const companies = new Set<string>();
  for (const j of list) {
    s.jobs++;
    if (j.qualified) s.qualified++;
    if (j.enriched) s.enriched++;
    const c = j.company.trim().toLowerCase();
    if (c && c !== "—") companies.add(c);
  }
  s.companies = companies.size;
  let done = 0;
  for (const c of coverage) {
    s.pagesCrawled += c.pages;
    if (c.status === "done" || c.status === "blocked" || c.status === "failed") done++;
    if (c.status === "blocked") s.blocked++;
  }
  s.queriesDone = done;
  job.summary = s;
  job.progress = coverage.length ? Math.round((done / coverage.length) * 100) : 100;
  if (done >= coverage.length && job.status === "collecting") {
    job.status = "completed";
    job.completedAt = new Date().toISOString();
  }
}

/** Reset blocked/failed queries to pending for a retry; clear their partial rows. */
export function retryBlockedQueries(jobId: string): string[] {
  const s = store();
  const job = getJob(jobId);
  const coverage = s.coverage[jobId];
  if (!job || !coverage) return [];
  const retry: string[] = [];
  for (const c of coverage) {
    if (c.status === "blocked" || c.status === "failed") {
      c.status = "pending"; c.jobsFound = 0; c.pages = 0;
      retry.push(c.key);
    }
  }
  if (retry.length === 0) return [];
  const retrySet = new Set(retry);
  s.results[jobId] = (s.results[jobId] ?? []).filter((j) => !retrySet.has(j.sourceQuery));
  job.status = "collecting";
  job.completedAt = undefined;
  recompute(jobId);
  scheduleSave();
  return retry;
}

export function deleteLinkedInSearch(id: string): boolean {
  const s = store();
  const before = s.jobs.length;
  s.jobs = s.jobs.filter((j) => j.id !== id);
  delete s.results[id];
  delete s.coverage[id];
  if (s.jobs.length < before) { persist(s); return true; }
  return false;
}

/* ------------------------------- enrichment ------------------------------ */

export function setEnrichStatus(jobId: string, status: LinkedInSearchJob["enrichStatus"]) {
  const job = getJob(jobId);
  if (job) { job.enrichStatus = status; scheduleSave(); }
}

/** Qualified rows not yet enriched — the targets of the opt-in enrich pass. */
export function enrichTargets(jobId: string): CollectedLinkedInJob[] {
  return (store().results[jobId] ?? []).filter((j) => j.qualified && !j.enriched);
}

/** Apply one job's detail + company info, then re-qualify + re-score in place. */
export function applyEnrichment(jobId: string, rowId: string, detail: LinkedInJobDetail, company: LinkedInCompanyInfo) {
  const job = getJob(jobId);
  const row = store().results[jobId]?.find((j) => j.id === rowId);
  if (!job || !row) return;
  if (detail.found) {
    row.description = detail.description ?? row.description;
    row.applicants = detail.applicants ?? row.applicants;
    row.employmentType = detail.employmentType ?? row.employmentType;
    row.seniority = detail.seniority ?? row.seniority;
    row.jobFunction = detail.jobFunction ?? row.jobFunction;
    if (detail.industries.length) row.industries = detail.industries;
    if (detail.companyLinkedinUrl && !row.companyLinkedinUrl) row.companyLinkedinUrl = detail.companyLinkedinUrl;
  }
  if (company.found) {
    row.companyEmployeeRange = company.employeeRange;
    row.companyEmployeeMin = company.employeeMin;
    row.companyIndustry = company.industry;
    row.companyWebsite = company.website;
    if (!row.industries.length && company.industry) row.industries = [company.industry];
  }
  row.enriched = true;
  const gate = qualifyJob(row, job.params, true);
  row.qualified = gate.qualified;
  row.rejectReason = gate.rejectReason;
  row.fitScore = scoreJob(row, job.params);
  recompute(jobId);
  scheduleSave();
}

export function finishEnrich(jobId: string) {
  setEnrichStatus(jobId, "enriched");
  persist(store());
}

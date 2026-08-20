/**
 * Server-side store for company multi-source collection jobs (Find Leads →
 * Companies tab import). Persists jobs + collected companies to `.data/collect.json`.
 */
import "server-only";
import fs from "fs";
import path from "path";
import type { CollectSummary, CollectedCompany, CompanyCollectJob } from "@/lib/leads/collect-types";

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
  return { total, enriched: 0, withWebsite: 0, withEmail: 0, withPhone: 0, withLinkedin: 0, rateLimited: 0, proxyRotations: 0 };
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

export interface CompaniesQuery { page?: number; pageSize?: number; search?: string; filter?: string }
export interface CompaniesPage { companies: CollectedCompany[]; total: number; page: number; pageSize: number }

export function getCompanies(jobId: string, query: CompaniesQuery = {}): CompaniesPage {
  const all = store().companies[jobId] ?? [];
  const { page = 1, pageSize = 25, search = "", filter = "all" } = query;
  let filtered = all;
  const q = search.trim().toLowerCase();
  if (q) filtered = filtered.filter((c) => c.inputName.toLowerCase().includes(q) || c.inputLocation.toLowerCase().includes(q) || (c.domainGuess ?? "").includes(q));
  if (filter === "enriched") filtered = filtered.filter((c) => c.status === "enriched");
  else if (filter === "has_email") filtered = filtered.filter((c) => !!(c.contactEmail || c.emailDomain));
  else if (filter === "has_phone") filtered = filtered.filter((c) => !!c.phone);
  else if (filter === "not_found") filtered = filtered.filter((c) => c.status === "not_found");
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  return { companies: filtered.slice(start, start + pageSize), total, page, pageSize };
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
    id, name: input.name, fileName: input.fileName, status: "collecting",
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
    website: null, emailDomain: null, contactEmail: null, phone: null, linkedin: null, twitter: null, facebook: null,
    address: null, mapsRating: null, industry: null, employees: null, revenue: null, founded: null, description: null,
    technologies: null, collection: [],
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
    if (c.website) s.withWebsite++;
    if (c.contactEmail || c.emailDomain) s.withEmail++;
    if (c.phone) s.withPhone++;
    if (c.linkedin) s.withLinkedin++;
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

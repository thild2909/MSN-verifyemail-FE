/**
 * Persistent cache of LinkedIn company lookups for the Qualify pass.
 *
 * The same employers (Grab, Hays, Randstad…) recur across scrapes; re-scraping
 * their company page (≈44 KB of Webshare bandwidth) or re-asking DeepSeek every
 * time is pure waste. Company-page data is cached 30 days (7 when the page was
 * missing), DeepSeek revenue/group answers 90 days (30 when unknown).
 * Persists to `.data/linkedin-company-cache.json`.
 */
import "server-only";
import fs from "fs";
import path from "path";
import type { LinkedInCompanyInfo } from "./linkedin-jobs-crawler-client";

export interface CachedSignal { at: number; found: boolean; revenueBand: string | null; parentGroup: string | null }
export interface CachedBacking { at: number; parentGroup: string | null; source: string | null }
interface Entry { at?: number; info?: LinkedInCompanyInfo; signal?: CachedSignal; backing?: CachedBacking; blocks?: number }

const DAY = 86_400_000;
const COMPANY_TTL = 30 * DAY;
const COMPANY_MISS_TTL = 7 * DAY;
const SIGNAL_TTL = 90 * DAY;
const SIGNAL_MISS_TTL = 30 * DAY;
const MAX_ENTRIES = 20_000;

const DATA_FILE = path.join(process.cwd(), ".data", "linkedin-company-cache.json");

declare global {
  // eslint-disable-next-line no-var
  var __linkedinCompanyCache: Record<string, Entry> | undefined;
}

function cache(): Record<string, Entry> {
  if (!globalThis.__linkedinCompanyCache) {
    try {
      globalThis.__linkedinCompanyCache = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) : {};
    } catch {
      globalThis.__linkedinCompanyCache = {};
    }
  }
  return globalThis.__linkedinCompanyCache!;
}

let saveTimer: NodeJS.Timeout | null = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const c = cache();
    const keys = Object.keys(c);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => (c[a].at ?? c[a].signal?.at ?? 0) - (c[b].at ?? c[b].signal?.at ?? 0));
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete c[k];
    }
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(c));
    } catch { /* best-effort */ }
  }, 2000);
}

/** Stable key: the /company/<slug> path when known (any linkedin subdomain), else the normalized name. */
export function companyKey(url: string | null | undefined, name: string): string {
  const m = (url ?? "").match(/linkedin\.com\/company\/([^/?#]+)/i);
  if (m) return `li:${decodeURIComponent(m[1]).toLowerCase()}`;
  return `name:${name.toLowerCase().replace(/\b(pte|ltd|limited|inc|llc|co|corp|sdn bhd|gmbh)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim()}`;
}

export function getCompany(key: string): LinkedInCompanyInfo | null {
  const e = cache()[key];
  if (!e?.info || !e.at) return null;
  if (!e.info.found && !e.info.notFound) return null; // a block was never a real miss
  const ttl = e.info.found ? COMPANY_TTL : COMPANY_MISS_TTL;
  return Date.now() - e.at < ttl ? e.info : null;
}

export function putCompany(key: string, info: LinkedInCompanyInfo) {
  if (!info.found && !info.notFound) return; // blocked/walled → retry next time, don't remember it
  const c = cache();
  c[key] = { ...c[key], at: Date.now(), info, blocks: 0 };
  scheduleSave();
}

/** Record one Qualify run on which this company was walled on every IP; returns the running count. */
export function noteBlocked(key: string): number {
  const c = cache();
  const blocks = (c[key]?.blocks ?? 0) + 1;
  c[key] = { ...c[key], blocks };
  scheduleSave();
  return blocks;
}

export function getSignal(key: string): CachedSignal | null {
  const s = cache()[key]?.signal;
  if (!s) return null;
  return Date.now() - s.at < (s.found ? SIGNAL_TTL : SIGNAL_MISS_TTL) ? s : null;
}

/** Live-search backing: 90 days when a parent was found, 30 when not. */
export function getBacking(key: string): CachedBacking | null {
  const b = cache()[key]?.backing;
  if (!b) return null;
  return Date.now() - b.at < (b.parentGroup ? SIGNAL_TTL : SIGNAL_MISS_TTL) ? b : null;
}

export function putBacking(key: string, backing: Omit<CachedBacking, "at">) {
  const c = cache();
  c[key] = { ...c[key], backing: { ...backing, at: Date.now() } };
  scheduleSave();
}

export function putSignal(key: string, signal: Omit<CachedSignal, "at">) {
  const c = cache();
  c[key] = { ...c[key], signal: { ...signal, at: Date.now() } };
  scheduleSave();
}

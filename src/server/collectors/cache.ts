/**
 * Collection cache. Keyed by normalized company name + location, persisted to
 * `.data/collect-cache.json` with a 30-day TTL. Apollo/Clay lean heavily on a
 * cache so the same company is never re-crawled needlessly; this is the
 * in-process equivalent (no Redis in this environment). A cache hit skips the
 * whole resolve → crawl pipeline and is surfaced to the UI.
 */
import "server-only";
import fs from "fs";
import path from "path";
import { normalizeName } from "./scoring";
import type { CollectedCompany } from "@/lib/leads/collect-types";

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "collect-cache.json");

export type CachedCompany = Omit<CollectedCompany, "id" | "jobId">;
interface Entry { at: number; company: CachedCompany; rateLimited: number }
type CacheMap = Record<string, Entry>;

declare global {
  // eslint-disable-next-line no-var
  var __collectCache: CacheMap | undefined;
}

function load(): CacheMap {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (parsed && typeof parsed === "object") return parsed as CacheMap;
    }
  } catch { /* start empty */ }
  return {};
}
function store(): CacheMap {
  if (!globalThis.__collectCache) globalThis.__collectCache = load();
  return globalThis.__collectCache;
}
let saveTimer: NodeJS.Timeout | null = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(store()));
    } catch { /* best-effort */ }
  }, 1500);
}

function keyFor(name: string, location: string): string {
  return `${normalizeName(name)}|${location.toLowerCase().trim()}`;
}

export function getCached(name: string, location: string): { company: CachedCompany; rateLimited: number } | null {
  const e = store()[keyFor(name, location)];
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) return null;
  return { company: e.company, rateLimited: e.rateLimited };
}

export function setCached(name: string, location: string, company: CachedCompany, rateLimited: number) {
  store()[keyFor(name, location)] = { at: Date.now(), company, rateLimited };
  scheduleSave();
}

function flushNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store()));
  } catch { /* best-effort */ }
}

/** Remove one cached collection row (in-memory + disk). */
export function deleteCached(name: string, location: string): boolean {
  const k = keyFor(name, location);
  const map = store();
  if (!(k in map)) return false;
  delete map[k];
  flushNow();
  return true;
}

/** Remove many cached collection rows. Returns count removed. */
export function deleteCachedMany(entries: { name: string; location: string }[]): number {
  const map = store();
  let removed = 0;
  for (const { name, location } of entries) {
    const k = keyFor(name, location);
    if (k in map) {
      delete map[k];
      removed++;
    }
  }
  if (removed) flushNow();
  return removed;
}

/**
 * Purge persisted resolution caches for companies in a collect job.
 * Clears FE `.data/collect-cache.json` and crawler-service `.data/cache.json`.
 */
import "server-only";
import { deleteCachedMany as deleteFeCachedMany } from "./collectors/cache";
import type { CollectedCompany } from "@/lib/leads/collect-types";

const BASE = process.env.CRAWLER_SERVICE_URL ?? "http://localhost:8090";
const TIMEOUT_MS = Number(process.env.CRAWLER_TIMEOUT_MS ?? 30_000);

export interface PurgeCollectCacheResult {
  companies: number;
  feCacheRemoved: number;
  beCacheRemoved: number;
  beCacheError?: string;
}

function uniqueCompanies(companies: CollectedCompany[]): { name: string; location: string }[] {
  const seen = new Set<string>();
  const out: { name: string; location: string }[] = [];
  for (const c of companies) {
    const name = c.inputName.trim();
    const location = c.inputLocation.trim();
    if (!name) continue;
    const k = `${name.toLowerCase()}|${location.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name, location });
  }
  return out;
}

/** Invalidate FE + BE caches for every company in the job. Best-effort on BE. */
export async function purgeCollectCaches(companies: CollectedCompany[]): Promise<PurgeCollectCacheResult> {
  const entries = uniqueCompanies(companies);
  const feCacheRemoved = deleteFeCachedMany(entries);

  let beCacheRemoved = 0;
  let beCacheError: string | undefined;
  if (entries.length) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE}/cache/invalidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: entries.map((e) => ({ company: e.name, location: e.location })),
        }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (res.ok) {
        const json = (await res.json()) as { removed?: number };
        beCacheRemoved = json.removed ?? 0;
      } else {
        beCacheError = `crawler-service responded ${res.status}`;
      }
    } catch (e) {
      beCacheError = e instanceof Error ? e.message : "crawler unreachable";
    } finally {
      clearTimeout(timer);
    }
  }

  return { companies: entries.length, feCacheRemoved, beCacheRemoved, beCacheError };
}

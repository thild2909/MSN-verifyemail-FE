/**
 * Shared context + helpers for the company collectors.
 *
 * Every source (resolver, website, opencorporates, simulated) receives the same
 * CollectContext and returns a SourceResult, so adding a source is one file and
 * the orchestrator never changes. The ProxyRotator and the small field helpers
 * live here so both the real and simulated collectors share one implementation.
 */
import "server-only";
import { seededRandom, sleep } from "@/lib/utils";
import { pickFingerprint, type ProxyLike } from "../proxy-fetch";
import type { CollectedCompany, CollectionAttempt, CollectionSource, SourcedField } from "@/lib/leads/collect-types";

export interface StoredProxy {
  id: string; label: string; host: string; port: number;
  type: "http" | "https" | "socks5"; username?: string; password?: string;
  enabled: boolean; status: string;
}

export interface Cfg {
  enabled: boolean; rotation: string; delayMs: number; backoffMs: number; maxRetries: number;
  proxies: StoredProxy[];
}

/** Confidence each source's fields carry before any agreement boost. */
export const SOURCE_CONFIDENCE: Record<CollectionSource, number> = {
  search: 88, website: 95, opencorporates: 92, linkedin: 90, google_maps: 80, directory: 78, social: 70, other: 65,
};

/* -------------------------------- rotation ------------------------------- */

export class ProxyRotator {
  private i = 0;
  rotations = 0;
  private pool: StoredProxy[];
  constructor(private cfg: Cfg) {
    this.pool = cfg.enabled ? cfg.proxies.filter((p) => p.enabled && p.status !== "dead") : [];
  }
  get active() { return this.pool.length > 0; }
  next(key: string): StoredProxy | null {
    if (this.pool.length === 0) return null;
    let idx: number;
    if (this.cfg.rotation === "random") idx = Math.floor(seededRandom(`${key}:${this.i}`) * this.pool.length);
    else if (this.cfg.rotation === "sticky_per_domain") idx = Math.floor(seededRandom(key) * this.pool.length);
    else idx = this.i % this.pool.length;
    this.i++;
    return this.pool[idx];
  }
}

export const proxyLabel = (p: StoredProxy | null): string | null => (p ? `${p.label} (${p.host}:${p.port})` : null);
export const toLike = (p: StoredProxy | null): ProxyLike | null =>
  p ? { type: p.type, host: p.host, port: p.port, username: p.username, password: p.password } : null;

export const sf = <T>(value: T, source: CollectionSource): SourcedField<T> => ({ value, source, confidence: SOURCE_CONFIDENCE[source] });

export const attempt = (
  source: CollectionSource,
  status: CollectionAttempt["status"],
  proxy: string | null,
  ms: number,
  fieldsFound: number,
  extra: Partial<CollectionAttempt> = {},
): CollectionAttempt => ({ source, status, proxy, ms, fieldsFound, ...extra });

/** Fingerprint for a fetch keyed to (domain, source, retry) so retries rotate. */
export const fingerprintFor = (key: string, bump = 0) => pickFingerprint(key, bump);

/**
 * Polite delay + jitter between requests, the way a real crawler paces itself
 * (`sleep(random(3,12))` in the spec, scaled to the configured base delay).
 */
export async function politeDelay(cfg: Cfg, key: string) {
  const base = Math.max(0, cfg.delayMs);
  if (base === 0) return;
  const jitter = Math.floor(seededRandom(`${key}:jit`) * base);
  await sleep(base + jitter);
}

/* ------------------------------- collector API --------------------------- */

export interface Resolved { website: string | null; linkedin: string | null }

export interface CollectContext {
  inputName: string;
  inputLocation: string;
  cfg: Cfg;
  rotator: ProxyRotator;
  resolved: Resolved; // filled by the resolver, read by the sources
}

export interface SourceResult {
  fields: Partial<CollectedCompany>;
  attempt: CollectionAttempt;
  rateLimited?: number;
}

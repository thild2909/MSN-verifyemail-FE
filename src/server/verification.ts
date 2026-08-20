/**
 * Server-side verification cache (P3).
 *
 * Wraps the backend verifier with a per-email result cache so the same address
 * isn't re-checked over its TTL — the way finder providers cache deliverability
 * for days. Only *confident* results from the real engine are cached; mock
 * results (backend offline) are never cached because they're non-deterministic
 * and would poison the cache with fake verdicts.
 */
import "server-only";
import { verifyWithBackend, type VerifyOutcome } from "@/lib/verifier/backend";
import type { VerificationStatus } from "@/lib/types";

interface CachedEntry {
  outcome: VerifyOutcome;
  at: number; // epoch ms
}

/** Default 14 days — inside the common 7–30 day window used by providers. */
const EMAIL_TTL_MS = Number(process.env.VERIFY_CACHE_TTL_MS ?? 14 * 24 * 3600 * 1000);

/**
 * Only DEFINITIVE verdicts are safe to cache. `unknown` / `risky` are transient
 * (greylisting, temporary SMTP failures, rate limits) and a retry can resolve
 * them to a real answer — caching them would freeze a false negative for days.
 */
const CACHEABLE_STATUS = new Set<VerificationStatus>([
  "valid",
  "invalid",
  "catch_all",
  "disposable",
  "role",
]);

declare global {
  // eslint-disable-next-line no-var
  var __verifyCache: Map<string, CachedEntry> | undefined;
}

function cache(): Map<string, CachedEntry> {
  if (!globalThis.__verifyCache) globalThis.__verifyCache = new Map();
  return globalThis.__verifyCache;
}

export interface CachedVerifyOutcome extends VerifyOutcome {
  /** True when served from cache (no backend call was made). */
  cached: boolean;
}

/**
 * Verify one email, using the cache unless `fresh` is requested. Returns the
 * outcome plus whether it was a cache hit so callers can meter real backend use.
 */
export async function cachedVerify(
  email: string,
  opts: { fresh?: boolean } = {},
): Promise<CachedVerifyOutcome> {
  const key = email.trim().toLowerCase();

  if (!opts.fresh) {
    const hit = cache().get(key);
    // Serve only fresh, DEFINITIVE cached verdicts. A stale or transient entry
    // (e.g. a previously-greylisted `unknown`) is dropped and re-verified.
    if (hit && Date.now() - hit.at <= EMAIL_TTL_MS && CACHEABLE_STATUS.has(hit.outcome.result.status)) {
      return { ...hit.outcome, cached: true };
    }
    if (hit) cache().delete(key);
  }

  const outcome = await verifyWithBackend(email);
  // Persist only real, DEFINITIVE engine results — never mock fallbacks or
  // transient (unknown/risky) verdicts.
  if (outcome.provider === "reacher" && CACHEABLE_STATUS.has(outcome.result.status)) {
    cache().set(key, { outcome, at: Date.now() });
  }
  return { ...outcome, cached: false };
}

export function verifyCacheStats(): { size: number } {
  return { size: cache().size };
}

/** Clear the per-email verification cache. Returns how many entries were removed. */
export function clearVerifyCache(): number {
  const n = cache().size;
  cache().clear();
  return n;
}

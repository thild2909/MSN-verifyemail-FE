/**
 * Full-coverage planner for ONE LinkedIn keyword × location query.
 *
 * LinkedIn's guest search serves at most ~1,000 cards per query (`start` ≤ 990),
 * and — verified live 2026-09-29 — ignores every narrowing facet except the
 * keywords, the location and `f_TPR` ("posted in the last N seconds"). A query
 * reporting "3,000+" can therefore only be covered by UNIONING many overlapping
 * ≤1,000 slices, deduped by job id:
 *
 *   1. count the query; if it's ≤ 990 exactly, one walk gets everything.
 *   2. newest window — binary-search the largest f_TPR window whose count is
 *      ≤ 950, and walk it: every role in it is collected, completely.
 *   3. the full window's top-1,000 (relevance-ranked, reaches older roles).
 *   4. term slices — `(kw) AND term` for the most frequent title words seen so
 *      far, walked until LinkedIn runs out (or the 1,000 ceiling).
 *   5. pair slices — `(kw) AND t1 AND t2` for terms that still hit the ceiling.
 *
 * Cost control (Webshare bandwidth + request volume): slices are walked in
 * 20-page chunks and a slice STOPS as soon as a chunk is ≥ 90% roles we already
 * have — overlapping slices cost one chunk, not 100 pages. Term slices skip the
 * (32 KB) count page; the walk itself detects the end.
 *
 * Stops when the found count reaches an exact total, when the last few slices
 * stop adding new roles (saturation), or at the slice budget. LinkedIn's "3,000+"
 * is a rounded lower bound, so coverage is reported against it, not guaranteed.
 */
import "server-only";
import type { LinkedInCount, LinkedInSliceQuery } from "./linkedin-jobs-crawler-client";

const EXACT_MAX = 990; // a slice this small is walked completely
const CHUNK_PAGES = 20; // pages per walk call (10 cards each)
const NOVELTY_MIN = Number(process.env.CRAWLER_LINKEDIN_NOVELTY_MIN ?? 0.1); // stop a slice below 10% new
const WINDOW_TARGET = 950; // newest-window target (headroom under the ceiling)
const MIN_WINDOW = 3_600; // f_TPR floor for the window search (1h)
const ANY_TIME_WINDOW = 2_592_000; // "any time" → search windows within 30 days
const WINDOW_SECONDS: Record<string, number | null> = { "24h": 86_400, "7d": 604_800, "30d": 2_592_000, any: null };

const STOPWORDS = new Set([
  "and", "the", "for", "with", "from", "into", "our", "your", "you", "are", "all", "new", "job", "jobs",
  "role", "roles", "based", "hiring", "urgent", "immediate", "contract", "permanent", "full", "time",
  "part", "remote", "hybrid", "onsite", "month", "months", "year", "years", "apac", "asia", "pacific",
]);

export interface PlannerDeps {
  count: (q: LinkedInSliceQuery) => Promise<LinkedInCount>;
  /** walk `maxPages` pages of a slice from card offset `start`; `added` = roles NEW to the scrape, `cards` = roles returned */
  walk: (q: LinkedInSliceQuery, maxPages: number, start: number) => Promise<WalkChunk>;
  /** roles this query has found so far */
  found: () => number;
  /** titles this query has found so far (seeds the split terms) */
  titles: () => string[];
  onTotal: (c: LinkedInCount) => void;
  onSlice: (slices: number) => void;
}

export interface WalkChunk { added: number; cards: number; blocked: boolean; exhausted?: boolean; error?: string }

export interface PlannerResult { slices: number; blockedSlices: number; lastError?: string; }

const pagesFor = (expected: number) => Math.min(100, Math.max(1, Math.ceil(expected / 10)));
const exact = (c: LinkedInCount) => c.count != null && !c.capped && c.count <= EXACT_MAX;

/** Wrap a multi-word keyword so `AND term` binds to the whole phrase. */
function andQuery(keyword: string, ...terms: string[]): string {
  const k = /\s/.test(keyword.trim()) ? `(${keyword.trim()})` : keyword.trim();
  return [k, ...terms].join(" AND ");
}

/** Most frequent title words not already part of the keyword. */
export function splitTerms(titles: string[], keyword: string, limit: number): string[] {
  const own = new Set(keyword.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const freq = new Map<string, number>();
  for (const t of titles) {
    const words = new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^\d+$/.test(w)));
    for (const w of words) if (!own.has(w) && !STOPWORDS.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return [...freq.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

export async function planFullCoverage(
  base: Omit<LinkedInSliceQuery, "keywords" | "tprSeconds"> & { keyword: string },
  deps: PlannerDeps,
): Promise<PlannerResult> {
  const maxSlices = Math.max(3, Number(process.env.CRAWLER_LINKEDIN_MAX_SLICES ?? 60));
  const termLimit = Math.max(5, Number(process.env.CRAWLER_LINKEDIN_SPLIT_TERMS ?? 30));
  const window = WINDOW_SECONDS[base.datePosted] ?? null;
  const q = (keywords: string, tprSeconds?: number | null): LinkedInSliceQuery => ({
    keywords, location: base.location, datePosted: base.datePosted, jobType: base.jobType,
    ...(tprSeconds ? { tprSeconds } : {}),
  });

  let slices = 0;
  let blockedSlices = 0;
  let lastError: string | undefined;
  const gains: number[] = [];
  // One failed slice/count (crawler restart, transport error) must not abort a
  // multi-thousand-role query: record it and carry on with the next slice.
  /**
   * Walk one slice in chunks. `expected` (a known exact count) bounds the pages;
   * `complete` disables the overlap stop (the newest window must be walked whole).
   * Returns roles added and whether it ran all the way to the 1,000 ceiling.
   */
  const walk = async (sq: LinkedInSliceQuery, expected: number | null, complete = false) => {
    slices++;
    const maxPages = expected != null ? pagesFor(expected) : 100;
    let added = 0;
    let hitCeiling = false;
    for (let page = 0; page < maxPages; page += CHUNK_PAGES) {
      let r: WalkChunk;
      try { r = await deps.walk(sq, Math.min(CHUNK_PAGES, maxPages - page), page * 10); }
      catch (e) { r = { added: 0, cards: 0, blocked: true, error: e instanceof Error ? e.message : String(e) }; }
      added += r.added;
      if (r.blocked) { blockedSlices++; lastError = r.error ?? lastError; break; }
      if (r.exhausted || r.cards === 0) break;
      if (page + CHUNK_PAGES >= 100) hitCeiling = true;
      // Mostly roles we already have → the rest of this slice is overlap too.
      if (!complete && r.added / r.cards < NOVELTY_MIN) break;
    }
    gains.push(added);
    deps.onSlice(slices);
    return { added, hitCeiling };
  };
  const count = async (sq: LinkedInSliceQuery): Promise<LinkedInCount> => {
    try { return await deps.count(sq); }
    catch (e) { lastError = e instanceof Error ? e.message : String(e); return { count: null, capped: false, text: null }; }
  };

  const total = await count(q(base.keyword, window));
  deps.onTotal(total);

  // Count unreachable → blind walk of the top 1,000 (still better than nothing).
  if (total.count == null) { await walk(q(base.keyword, window), null, true); return { slices, blockedSlices, lastError }; }
  if (total.count === 0) return { slices, blockedSlices, lastError };
  if (exact(total)) { await walk(q(base.keyword, window), total.count, true); return { slices, blockedSlices, lastError }; }

  const target = total.count;
  const done = () => slices >= maxSlices || (!total.capped && deps.found() >= target);
  // Saturated: each of the last 3 slices added < 1% of what we already have
  // (every slice costs up to 100 page fetches of Webshare bandwidth).
  const saturated = () => gains.length >= 5 && gains.slice(-3).every((g) => g < Math.max(5, deps.found() * 0.01));

  // 2. Newest fully-walkable window (binary search on f_TPR seconds).
  let lo = MIN_WINDOW, hi = window ?? ANY_TIME_WINDOW, best: { sec: number; n: number } | null = null;
  const probe = await count(q(base.keyword, lo));
  if (probe.count != null && !probe.capped && probe.count <= WINDOW_TARGET) {
    best = { sec: lo, n: probe.count };
    for (let i = 0; i < 9 && hi - lo > MIN_WINDOW; i++) {
      const mid = Math.round((lo + hi) / 2);
      const c = await count(q(base.keyword, mid));
      if (c.count != null && !c.capped && c.count <= WINDOW_TARGET) { best = { sec: mid, n: c.count }; lo = mid; } else hi = mid;
    }
  }
  if (best && best.n > 0) await walk(q(base.keyword, best.sec), best.n, true);

  // 3. Full window, top 1,000 by relevance (stops early once it's all overlap).
  if (!done()) await walk(q(base.keyword, window), null);

  // 4. Term slices, 5. pair slices for the terms that were still too big.
  const big: string[] = [];
  const tried = new Set<string>();
  const runTerms = async (terms: string[][]) => {
    for (const t of terms) {
      if (done() || saturated()) return;
      const kw = andQuery(base.keyword, ...t);
      if (tried.has(kw)) continue;
      tried.add(kw);
      const r = await walk(q(kw, window), null);
      // Still new roles all the way to the 1,000 ceiling → worth splitting further.
      if (t.length === 1 && r.hitCeiling) big.push(t[0]);
    }
  };
  // Re-derive terms after each round so later terms reflect newly found titles.
  for (let round = 0; round < 3 && !done() && !saturated(); round++) {
    const terms = splitTerms(deps.titles(), base.keyword, termLimit).filter((t) => !tried.has(andQuery(base.keyword, t)));
    if (!terms.length) break;
    await runTerms(terms.map((t) => [t]));
  }
  const pairsOf = big.slice(0, 8);
  const pairs: string[][] = [];
  for (let i = 0; i < pairsOf.length; i++) for (let j = i + 1; j < pairsOf.length; j++) pairs.push([pairsOf[i], pairsOf[j]]);
  await runTerms(pairs);

  return { slices, blockedSlices, lastError };
}

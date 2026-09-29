/**
 * Background runners for a LinkedIn scrape.
 *
 *  - startLinkedInSearch: fans out over the pending keyword×location queries
 *    (bounded concurrency), streaming discovered/normalized roles in. With
 *    maxPages = 0 each query runs the full-coverage planner (linkedin-jobs-planner)
 *    that splits results beyond LinkedIn's 1,000 ceiling into slices.
 *  - startLinkedInEnrich: the opt-in "Qualify companies" pass — company page
 *    once per company (persistently cached) → qualify → job detail only for rows
 *    still qualified → DeepSeek revenue/group only where it can change the score.
 */
import "server-only";
import {
  searchLinkedInViaCrawler, countLinkedInViaCrawler, enrichLinkedInViaCrawler, companySignalsViaCrawler, companyViaCrawler,
  companyBackingViaCrawler, type LinkedInCompanyInfo, type CompanySignalSeed, type BackingSeed,
} from "./linkedin-jobs-crawler-client";
import { planFullCoverage } from "./linkedin-jobs-planner";
import * as store from "./linkedin-jobs-collect-store";
import { discoveryKeyword } from "@/lib/leads/linkedin-normalize";
import * as companyCache from "./linkedin-company-cache";
import { hasRevenue, isGroupBacked } from "@/lib/leads/linkedin-normalize";

const CRAWL_CONCURRENCY = Math.max(1, Math.min(Number(process.env.CRAWLER_LINKEDIN_CONCURRENCY ?? 2), 5));
// Distinct company pages / job details go to distinct Webshare IPs, so modest
// parallelism doesn't concentrate load on any one IP.
const COMPANY_CONCURRENCY = Math.max(1, Math.min(Number(process.env.CRAWLER_LINKEDIN_COMPANY_CONCURRENCY ?? 6), 12));
const DETAIL_CONCURRENCY = Math.max(1, Math.min(Number(process.env.CRAWLER_LINKEDIN_ENRICH_CONCURRENCY ?? 6), 12));
const NO_COMPANY: LinkedInCompanyInfo = { employeeRange: null, employeeMin: null, industry: null, website: null, found: false };

const crawling = new Set<string>();
const enriching = new Set<string>();

export function startLinkedInSearch(id: string) {
  if (crawling.has(id)) return;
  crawling.add(id);
  void runCrawl(id)
    .catch((e) => console.error(`[linkedin] crawl ${id} failed:`, e))
    .finally(() => { crawling.delete(id); store.finalizeLinkedInSearch(id); });
}
export function isLinkedInSearchRunning(id: string) { return crawling.has(id); }

export function startLinkedInEnrich(id: string) {
  if (enriching.has(id)) return;
  enriching.add(id);
  // Always settle the persisted status, even if the pass throws — otherwise the
  // UI spins on "Qualifying…" forever.
  void runEnrich(id)
    .catch((e) => console.error(`[linkedin] enrich ${id} failed:`, e))
    .finally(() => { enriching.delete(id); store.finishEnrich(id); });
}
export function isLinkedInEnriching(id: string) { return enriching.has(id); }

async function runCrawl(id: string) {
  const job = store.getLinkedInSearch(id);
  if (!job) return;
  const pending = job.coverage.filter((c) => c.status === "pending");
  const queries = pending.length ? pending : job.coverage;
  const params = job.params;
  let next = 0;

  async function worker() {
    while (next < queries.length) {
      const q = queries[next++];
      store.setQueryCollecting(id, q.key);
      const keyword = discoveryKeyword(q.keyword, params);
      try {
        if (params.maxPages > 0) {
          // Fixed depth: one walk of the top N pages.
          const r = await searchLinkedInViaCrawler({
            keywords: keyword, location: q.location, datePosted: params.datePosted, jobType: params.jobType, maxPages: params.maxPages,
          });
          store.appendLinkedInJobs(id, q.key, r.jobs, { pages: r.pages });
          store.finalizeQuery(id, q.key, r.blocked ? "blocked" : "done", r.blocked ? (r.error || "blocked by LinkedIn") : undefined);
          continue;
        }
        // All results: plan + walk ≤1,000 slices until LinkedIn's total is covered.
        const res = await planFullCoverage(
          { keyword, location: q.location, datePosted: params.datePosted, jobType: params.jobType },
          {
            count: (sq) => countLinkedInViaCrawler(sq),
            walk: async (sq, maxPages, start) => {
              const r = await searchLinkedInViaCrawler({ ...sq, maxPages, start });
              const added = store.appendLinkedInJobs(id, q.key, r.jobs, { pages: r.pages });
              return { added, cards: r.jobs.length, blocked: r.blocked, exhausted: r.exhausted, error: r.error };
            },
            found: () => store.queryFound(id, q.key),
            titles: () => store.queryTitles(id, q.key),
            onTotal: (c) => store.setQueryMeta(id, q.key, { total: c.count, totalCapped: c.capped }),
            onSlice: (slices) => store.setQueryMeta(id, q.key, { slices }),
          },
        );
        const found = store.queryFound(id, q.key);
        const blocked = found === 0 && res.blockedSlices > 0;
        store.finalizeQuery(id, q.key, blocked ? "blocked" : "done", blocked ? (res.lastError || "blocked by LinkedIn") : undefined);
      } catch (e) {
        // Surface WHY (e.g. crawler-service 404 → endpoint not deployed) instead of a silent "failed".
        store.finalizeQuery(id, q.key, "failed", e instanceof Error ? e.message : String(e));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CRAWL_CONCURRENCY, queries.length || 1) }, () => worker()));
  // No auto-enrich: rows stay "pending" until the user clicks "Qualify companies"
  // (opt-in-expensive-ops) — that pass verifies each row and sets `qualified`.
}

async function runEnrich(id: string) {
  store.setEnrichStatus(id, "enriching");
  const params = store.getLinkedInSearch(id)?.params;
  const targets = store.enrichTargets(id);
  if (!params || targets.length === 0) return;

  // Group rows by hiring company: each company page is looked up ONCE.
  const groups = new Map<string, { key: string; ref: string; name: string; rowIds: string[] }>();
  for (const row of targets) {
    const key = companyCache.companyKey(row.companyLinkedinUrl, row.company);
    const g = groups.get(key) ?? { key, ref: row.companyLinkedinUrl || row.company, name: row.company, rowIds: [] };
    g.rowIds.push(row.id);
    groups.set(key, g);
  }
  const groupList = [...groups.values()];

  // Phase 1 — company page (cache first). This alone decides qualification
  // (size / industry), so it runs before any per-row work.
  await pool(groupList, COMPANY_CONCURRENCY, async (g) => {
    let info = g.name === "—" ? NO_COMPANY : companyCache.getCompany(g.key);
    if (!info) {
      try {
        info = await companyViaCrawler(g.ref);
        companyCache.putCompany(g.key, info);
        // Walled on every IP (not a 404): leave PENDING so the next Qualify retries,
        // rather than judging the row on data we never saw.
        if (!info.found && !info.notFound) return;
      } catch {
        // Transport error (crawler restart / timeout): leave these rows PENDING —
        // not "qualified" on missing data, and the next Qualify click retries them.
        return;
      }
    }
    store.applyCompany(id, g.rowIds, info);
  });

  // Phase 2 — job detail (employment type, seniority, description) ONLY for rows
  // that still qualify: a row rejected on company size/industry never needs it.
  const rows = store.rowsById(id);
  const detailIds = targets.map((t) => t.id).filter((rid) => rows.get(rid)?.qualified);
  await pool(detailIds, DETAIL_CONCURRENCY, async (rid) => {
    const row = rows.get(rid);
    if (!row) return;
    try {
      const r = await enrichLinkedInViaCrawler({ jobId: row.linkedinJobId, companyRef: "", withCompany: false });
      store.applyDetail(id, rid, r.detail);
    } catch {
      // Detail is display-only, except for the Remote gate (falls back to location/title).
      store.applyDetail(id, rid, { linkedinJobId: row.linkedinJobId, description: null, applicants: null, employmentType: null, seniority: null, jobFunction: null, industries: [], companyLinkedinUrl: null, found: false });
    }
  });

  // Phase 3 — revenue / corporate group from DeepSeek knowledge (cheap, batched),
  // then Phase 4 — live-search evidence for small companies still without a
  // parent (catches recent acquisitions the model doesn't know). Best-effort.
  await applyCompanySignals(id, groupList);
  await applyLiveBacking(id, groupList);
}

/**
 * Live web evidence for corporate backing — the case that matters most and that
 * training knowledge misses: a SMALL company recently acquired / backed by a
 * group (Linxio ← Banyan Software). Only for companies that
 *   - still have a qualified row (a rejected company can't benefit),
 *   - have no parent yet from LinkedIn affiliates or DeepSeek knowledge,
 *   - are ≤ 1,000 employees or unknown size (large firms get the revenue bonus),
 *   - weren't searched in the last 30/90 days (cache),
 * capped per run (BACKING_MAX_PER_RUN, default 150) so a huge scrape can't turn
 * into a search-engine flood.
 */
async function applyLiveBacking(id: string, groupList: { key: string; name: string; rowIds: string[] }[]) {
  const maxPerRun = Math.max(0, Number(process.env.BACKING_MAX_PER_RUN ?? 150));
  const rows = store.rowsById(id);
  const seeds: (BackingSeed & { rowIds: string[] })[] = [];
  for (const g of groupList) {
    const first = rows.get(g.rowIds[0]);
    if (!first || g.name === "—") continue;
    const cached = companyCache.getBacking(g.key);
    if (cached) {
      if (cached.parentGroup) store.applyCompanyBacking(id, g.rowIds, { parentGroup: cached.parentGroup, source: cached.source });
      continue;
    }
    if (!g.rowIds.some((rid) => rows.get(rid)?.qualified)) continue;
    if (isGroupBacked(first)) continue;
    if (first.companyEmployeeMin != null && first.companyEmployeeMin > 1000) continue;
    if (seeds.length >= maxPerRun) break;
    seeds.push({
      id: g.key, name: first.company, domain: first.companyWebsite, location: first.country ?? first.location,
      industry: first.companyIndustry, rowIds: g.rowIds,
    });
  }
  for (let i = 0; i < seeds.length; i += 20) {
    const chunk = seeds.slice(i, i + 20);
    try {
      const res = await companyBackingViaCrawler(chunk.map(({ rowIds: _r, ...seed }) => seed));
      if (!res.configured) return;
      for (const r of res.results) {
        const seed = chunk.find((c) => c.id === r.id);
        if (!seed || !r.searched) continue;
        companyCache.putBacking(seed.id, { parentGroup: r.parentGroup, source: r.source });
        if (r.parentGroup) store.applyCompanyBacking(id, seed.rowIds, { parentGroup: r.parentGroup, source: r.source });
      }
    } catch (e) {
      console.error(`[linkedin] live backing ${id} failed:`, e);
    }
  }
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/**
 * DeepSeek revenue band + corporate parent — asked only where it can change the
 * outcome: companies with a qualified row that LinkedIn hasn't already shown to
 * be listed / part of a group (those already earn the +10), and not answered in
 * the last 90 days (cache).
 */
async function applyCompanySignals(id: string, groupList: { key: string; name: string; rowIds: string[] }[]) {
  const rows = store.rowsById(id);
  const seeds: (CompanySignalSeed & { key: string; rowIds: string[] })[] = [];
  for (const g of groupList) {
    const first = rows.get(g.rowIds[0]);
    if (!first || g.name === "—") continue;
    const cached = companyCache.getSignal(g.key);
    if (cached) { if (cached.found) store.applyCompanySignal(id, g.rowIds, cached); continue; }
    if (!g.rowIds.some((rid) => rows.get(rid)?.qualified)) continue; // rejected company → no value
    if (hasRevenue(first) || isGroupBacked(first)) continue; // bonus already earned from LinkedIn
    seeds.push({
      id: g.key, key: g.key, name: first.company, location: first.country ?? first.location, website: first.companyWebsite,
      linkedin: first.companyLinkedinUrl, industry: first.companyIndustry, employees: first.companyEmployeeRange,
      rowIds: g.rowIds,
    });
  }
  for (let i = 0; i < seeds.length; i += 100) {
    const chunk = seeds.slice(i, i + 100);
    try {
      const res = await companySignalsViaCrawler(chunk.map(({ rowIds: _r, key: _k, ...seed }) => seed));
      if (!res.configured) return; // no DeepSeek key → skip the whole step
      for (const sig of res.signals) {
        const seed = chunk.find((c) => c.id === sig.id);
        if (!seed) continue;
        companyCache.putSignal(seed.key, { found: sig.found, revenueBand: sig.revenueBand, parentGroup: sig.parentGroup });
        if (sig.found) store.applyCompanySignal(id, seed.rowIds, sig);
      }
    } catch (e) {
      console.error(`[linkedin] company signals ${id} failed:`, e);
    }
  }
}

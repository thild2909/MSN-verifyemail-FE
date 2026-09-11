/**
 * Background runners for a LinkedIn scrape.
 *
 *  - startLinkedInSearch: fans out over the pending keyword×location queries
 *    (bounded concurrency), streaming discovered/normalized/qualified roles in.
 *  - startLinkedInEnrich: the opt-in "Qualify companies" pass — fetches each
 *    qualified role's detail page and scrapes its hiring company's page ONCE
 *    (grouped by company), then re-qualifies/re-scores in place.
 */
import "server-only";
import { searchLinkedInViaCrawler, enrichLinkedInViaCrawler, type LinkedInCompanyInfo } from "./linkedin-jobs-crawler-client";
import * as store from "./linkedin-jobs-collect-store";

const CRAWL_CONCURRENCY = Math.max(1, Math.min(Number(process.env.CRAWLER_LINKEDIN_CONCURRENCY ?? 2), 5));
const ENRICH_CONCURRENCY = Math.max(1, Math.min(Number(process.env.CRAWLER_LINKEDIN_ENRICH_CONCURRENCY ?? 3), 6));
const NO_COMPANY: LinkedInCompanyInfo = { employeeRange: null, employeeMin: null, industry: null, website: null, found: false };

const crawling = new Set<string>();
const enriching = new Set<string>();

export function startLinkedInSearch(id: string) {
  if (crawling.has(id)) return;
  crawling.add(id);
  void runCrawl(id).finally(() => crawling.delete(id));
}
export function isLinkedInSearchRunning(id: string) { return crawling.has(id); }

export function startLinkedInEnrich(id: string) {
  if (enriching.has(id)) return;
  enriching.add(id);
  void runEnrich(id).finally(() => enriching.delete(id));
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
      try {
        const r = await searchLinkedInViaCrawler({
          keywords: q.keyword,
          location: q.location,
          datePosted: params.datePosted,
          jobType: params.jobType,
          maxPages: params.maxPages,
        });
        store.appendLinkedInJobs(id, q.key, r.jobs, { pages: r.pages });
        store.finalizeQuery(id, q.key, r.blocked ? "blocked" : "done", r.blocked ? (r.error || "blocked by LinkedIn") : undefined);
      } catch (e) {
        // Surface WHY (e.g. crawler-service 404 → endpoint not deployed) instead of a silent "failed".
        store.finalizeQuery(id, q.key, "failed", e instanceof Error ? e.message : String(e));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CRAWL_CONCURRENCY, queries.length || 1) }, () => worker()));
  store.finalizeLinkedInSearch(id);
}

async function runEnrich(id: string) {
  store.setEnrichStatus(id, "enriching");
  const params = store.getLinkedInSearch(id)?.params;
  const targets = store.enrichTargets(id);
  if (!params || targets.length === 0) { store.finishEnrich(id); return; }

  // Group qualified rows by hiring company so its page is scraped only once.
  const groups = new Map<string, typeof targets>();
  for (const row of targets) {
    const ref = row.companyLinkedinUrl || row.company;
    const key = ref.toLowerCase();
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(row);
  }
  const groupList = [...groups.values()];
  let next = 0;

  async function worker() {
    while (next < groupList.length) {
      const rows = groupList[next++];
      const first = rows[0];
      const companyRef = first.companyLinkedinUrl || first.company;
      // Always enrich the company in the qualify pass — it fills the "Company
      // employees" + industry columns regardless of whether a size/industry
      // filter is set (the filter only affects qualification, not collection).
      const wantCompany = true;
      let companyInfo: LinkedInCompanyInfo = NO_COMPANY;
      // First row: fetch detail + company (once for the group).
      try {
        const r = await enrichLinkedInViaCrawler({ jobId: first.linkedinJobId, companyRef, withCompany: wantCompany });
        companyInfo = r.company;
        store.applyEnrichment(id, first.id, r.detail, r.company);
      } catch {
        store.applyEnrichment(id, first.id, { linkedinJobId: first.linkedinJobId, description: null, applicants: null, employmentType: null, seniority: null, jobFunction: null, industries: [], companyLinkedinUrl: null, found: false }, NO_COMPANY);
      }
      // Remaining rows of the same company: detail only, reuse the cached company info.
      for (const row of rows.slice(1)) {
        try {
          const r = await enrichLinkedInViaCrawler({ jobId: row.linkedinJobId, companyRef: "", withCompany: false });
          store.applyEnrichment(id, row.id, r.detail, companyInfo);
        } catch {
          store.applyEnrichment(id, row.id, { linkedinJobId: row.linkedinJobId, description: null, applicants: null, employmentType: null, seniority: null, jobFunction: null, industries: [], companyLinkedinUrl: null, found: false }, companyInfo);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(ENRICH_CONCURRENCY, groupList.length || 1) }, () => worker()));
  store.finishEnrich(id);
}

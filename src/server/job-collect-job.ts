/**
 * Background runner for a job-search crawl. Fans out over the selected boards,
 * crawling each through the standalone crawler-service (Playwright + proxy
 * pool). Boards run concurrently (bounded) and stream roles into the store as
 * each finishes, so the table fills in live. No mock data.
 */
import "server-only";
import { searchJobsViaCrawler } from "./job-crawler-client";
import * as store from "./job-collect-store";
import type { JobSource } from "@/lib/leads/job-collect-types";

const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CRAWLER_JOBS_CONCURRENCY ?? 2), 6));
const running = new Set<string>();

export function startJobSearch(id: string) {
  if (running.has(id)) return;
  running.add(id);
  void run(id).finally(() => running.delete(id));
}
export function isJobSearchRunning(id: string) {
  return running.has(id);
}

async function run(id: string) {
  const job = store.getJobSearch(id);
  if (!job) return;
  const sources = [...job.sources];
  const params = job.params;
  let next = 0;

  async function worker() {
    while (next < sources.length) {
      const source = sources[next++] as JobSource;
      store.setSourceCollecting(id, source);
      try {
        const r = await searchJobsViaCrawler(source, params);
        store.appendJobs(id, source, r.jobs, { pages: r.pages, proxyRotations: r.proxyRotations });
        store.finalizeSource(id, source, r.blocked ? "blocked" : "done");
      } catch {
        store.finalizeSource(id, source, "failed");
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sources.length || 1) }, () => worker()));
  store.finalizeJobSearch(id);
}

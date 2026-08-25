/**
 * Client for the crawler-service `/jobs/search` endpoint. Crawls ONE job board
 * for a keyword/location query (through the service's Playwright browser +
 * proxy pool) and maps the service's raw jobs onto the FE `CollectedJob` shape.
 */
import "server-only";
import type { CollectionAttempt } from "@/lib/leads/collect-types";
import type { CollectedJob, JobSource } from "@/lib/leads/job-collect-types";

const BASE = process.env.CRAWLER_SERVICE_URL ?? "http://localhost:8090";
const TIMEOUT_MS = Number(process.env.CRAWLER_JOBS_TIMEOUT_MS ?? 180_000);

/** A crawled job before the store assigns id/jobId/companyLogoText. */
export type CrawledJob = Omit<CollectedJob, "id" | "jobId" | "companyLogoText">;

interface RawJob {
  source: JobSource;
  externalId: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  salary: string | null;
  posted: string | null;
  postedDaysAgo: number | null;
  workMode: string | null;
  employmentType: string | null;
  technologies: string[];
}
interface JobSearchResult {
  source: JobSource;
  jobs: RawJob[];
  pages: number;
  blocked: boolean;
  proxyRotations: number;
  provider: string;
  error?: string;
}

const SOURCE_COUNTRY: Record<JobSource, string | null> = {
  seek: "Australia",
  reed: "United Kingdom",
  dice: "United States",
  indeed: null,
  ctgoodjobs: "Hong Kong",
  foundit: "India",
  glassdoor: null,
  mycareersfuture: "Singapore",
  wellfound: "United States",
};

export interface SourceCrawlResult {
  jobs: CrawledJob[];
  pages: number;
  blocked: boolean;
  proxyRotations: number;
  error?: string;
}

/** Crawl one board. Throws only on transport error; a blocked board resolves
 *  with `blocked: true` and whatever jobs were gathered. */
export async function searchJobsViaCrawler(
  source: JobSource,
  query: { keywords: string; location: string; maxPages: number },
): Promise<SourceCrawlResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/jobs/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, keywords: query.keywords, location: query.location, maxPages: query.maxPages }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`crawler-service /jobs/search responded ${res.status}`);
    const data = (await res.json()) as JobSearchResult;
    const collection = (ms: number): CollectionAttempt[] => [
      { source: "search", status: data.blocked ? "blocked" : "ok", proxy: null, ms, fieldsFound: 0, detail: `${data.pages} page(s) · ${data.provider}`, provider: data.provider },
    ];
    const jobs: CrawledJob[] = (data.jobs ?? []).map((j) => ({
      source,
      externalId: j.externalId,
      title: j.title,
      company: j.company,
      location: j.location,
      country: SOURCE_COUNTRY[source],
      url: j.url,
      salary: j.salary,
      posted: j.posted,
      postedDaysAgo: j.postedDaysAgo,
      workMode: j.workMode,
      employmentType: j.employmentType,
      technologies: j.technologies ?? [],
      collection: collection(0),
    }));
    return { jobs, pages: data.pages, blocked: data.blocked, proxyRotations: data.proxyRotations, error: data.error };
  } finally {
    clearTimeout(timer);
  }
}

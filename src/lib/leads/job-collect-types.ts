/**
 * Find Leads — Jobs collection model (real crawl).
 *
 * A job-search crawl takes the Jobs-tab filter state (titles, location, work
 * mode, …) and crawls one or more public job boards for matching open roles,
 * through the standalone crawler-service — the SAME real pipeline (headless
 * Playwright browser + rotating proxy pool) the Companies/People crawls use.
 * Every role is attributed to the SOURCE board that supplied it, which the
 * Jobs table renders as a dedicated "Source" column.
 *
 * Unlike People (seed = company) a job crawl fans out over SOURCES: each
 * selected board is one unit of work, producing many roles, so job progress is
 * "boards done / boards selected".
 */
import type { CollectionAttempt, VerifyStatus } from "./collect-types";

/** Job boards the server-side crawler can search. Ported from the browser
 *  extension's per-site crawlers. */
export const JOB_SOURCES = [
  "seek",
  "indeed",
  "reed",
  "dice",
  "ctgoodjobs",
  "foundit",
  "glassdoor",
  "mycareersfuture",
  "wellfound",
] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

export const JOB_SOURCE_LABEL: Record<JobSource, string> = {
  seek: "Seek",
  indeed: "Indeed",
  reed: "Reed",
  dice: "Dice",
  ctgoodjobs: "CTgoodjobs",
  foundit: "Foundit",
  glassdoor: "Glassdoor",
  mycareersfuture: "MyCareersFuture",
  wellfound: "Wellfound",
};

/** Short region hint shown next to each source so the user knows its coverage. */
export const JOB_SOURCE_REGION: Record<JobSource, string> = {
  seek: "AU / NZ",
  indeed: "Global",
  reed: "UK",
  dice: "US tech",
  ctgoodjobs: "Hong Kong",
  foundit: "India / SEA",
  glassdoor: "Global",
  mycareersfuture: "Singapore",
  wellfound: "US startups",
};

export type CollectedJobStatus = "found";

/** One open role discovered on a job board. */
export interface CollectedJob {
  id: string;
  jobId: string; // parent crawl id
  source: JobSource; // which board supplied it — the "Source" column
  externalId: string; // board-native id, used to dedupe across pages
  title: string;
  company: string;
  companyLogoText: string;
  location: string | null;
  country: string | null;
  url: string; // canonical detail URL on the source board
  salary: string | null; // free-text as shown on the board
  posted: string | null; // free-text ("3 days ago", "Listed today")
  postedDaysAgo: number | null; // parsed from `posted` when possible (for sort/filter)
  workMode: string | null; // "Remote" | "Hybrid" | "On-site" | null
  employmentType: string | null; // "Full time" | "Contract" | … | null
  technologies: string[]; // keyword tags parsed from the card, when present
  collection: CollectionAttempt[]; // per-source crawl log (proxy, ms, pages…)
}

export interface JobSearchSummary {
  sources: number; // boards selected
  sourcesDone: number; // boards finished (ok or blocked)
  jobs: number; // total roles found
  bySource: Partial<Record<JobSource, number>>; // roles per board
  companies: number; // distinct employers
  blocked: number; // boards that returned blocked / no results
  pagesCrawled: number;
  proxyRotations: number;
}

export type JobCollectStatus = "collecting" | "completed" | "failed";

/** The filter state that seeds a crawl. A subset of the Jobs-tab filters that
 *  actually map onto a board search — the rest are applied client-side after. */
export interface JobCrawlParams {
  keywords: string; // primary query — usually the joined titles / search box
  location: string; // free-text location ("Sydney", "London", "Remote")
  maxPages: number; // pages to walk per source (bounded)
}

export interface JobCollectJob {
  id: string;
  name: string;
  sources: JobSource[]; // boards this crawl targeted
  params: JobCrawlParams;
  status: JobCollectStatus;
  verifyStatus: VerifyStatus; // reserved (parity with company/people jobs)
  progress: number; // 0-100 (boards done / boards selected)
  summary: JobSearchSummary;
  createdAt: string;
  completedAt?: string;
}

/** Per-source coverage line for the crawl (how many roles each board returned). */
export interface JobSourceCoverage {
  source: JobSource;
  status: "pending" | "collecting" | "done" | "blocked" | "failed";
  jobsFound: number;
  pages: number;
}

export function emptyJobSummary(sources: number): JobSearchSummary {
  return { sources, sourcesDone: 0, jobs: 0, bySource: {}, companies: 0, blocked: 0, pagesCrawled: 0, proxyRotations: 0 };
}

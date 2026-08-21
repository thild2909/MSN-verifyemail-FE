/**
 * Find Leads — People collection model (real crawl).
 *
 * A people-collect job seeds from one or more resolved companies (typically via
 * "Find people" on the Companies tab) and crawls each company's decision-makers
 * (founders / co-founders / C-level / president / VP) from the public web
 * through the standalone crawler-service — the same real pipeline the company
 * crawl uses (Brave X-ray on linkedin.com/in + rotating residential proxies).
 * Every person is attributed to the source that supplied it; emails are guessed
 * from the company domain (`pattern`) and can be verified on demand.
 */
import type {
  CollectionAttempt,
  EmailVerification,
  LlmVerdict,
  SourcedField,
  VerifyStatus,
} from "./collect-types";

export type PersonSeniority = "founder" | "c_level" | "president" | "vp" | "other";

export const SENIORITY_LABEL: Record<PersonSeniority, string> = {
  founder: "Founder",
  c_level: "C-Level",
  president: "President",
  vp: "VP",
  other: "Other",
};

export type PersonStatus = "found" | "not_found";

/** One decision-maker discovered for a company. */
export interface CollectedPerson {
  id: string;
  jobId: string;
  // Company context (the seed this person was found for).
  companyId: string | null; // source CollectedCompany id, if seeded from a company
  company: string;
  companyDomain: string | null;
  companyLogoText: string;
  // Person.
  name: string;
  firstName: string;
  lastName: string;
  title: SourcedField | null;
  seniority: PersonSeniority;
  linkedin: SourcedField | null;
  email: SourcedField | null; // guessed (pattern) or found on the web
  emailKind: "found" | "pattern" | "none";
  location: string | null;
  confidence: number; // 0-100
  emailVerification: EmailVerification | null;
  llmVerification?: LlmVerdict | null; // DeepSeek founder↔company cross-check (opt-in)
  collection: CollectionAttempt[];
}

export interface PeopleSummary {
  companies: number; // seed companies
  companiesWithPeople: number;
  people: number;
  founders: number;
  cLevel: number;
  vps: number;
  withEmail: number;
  withLinkedin: number;
  emailsVerified: number;
  emailsValid: number;
}

export type PeopleCollectStatus = "collecting" | "completed" | "failed";

/**
 * `discover` — seed = company, crawl ALL its founders/C-level ("Find people").
 * `enrich`   — seed = a known person (First/Last/Company from CSV import), find
 *              THAT person's LinkedIn + title + email.
 */
export type PeopleJobMode = "discover" | "enrich";

/** Per-seed-company breakdown: how many people were found for each. */
export interface PeopleSeedCoverage {
  company: string;
  status: string; // pending | collecting | done | failed
  peopleFound: number;
}

export interface PeopleCollectJob {
  id: string;
  name: string;
  mode: PeopleJobMode;
  coverage?: PeopleSeedCoverage[]; // filled on the job-detail read
  status: PeopleCollectStatus;
  verifyStatus: VerifyStatus;
  totalCompanies: number;
  processedCompanies: number;
  progress: number; // 0-100
  summary: PeopleSummary;
  createdAt: string;
  completedAt?: string;
}

/** Faceted filter state for the People table sidebar. */
export interface PeopleFilters {
  seniority: string[]; // founder | c_level | president | vp | other
  email: string[]; // has | valid | bad
  linkedin: boolean; // must have a LinkedIn URL
  companies: string[]; // company names to include
}

export const EMPTY_PEOPLE_FILTERS: PeopleFilters = { seniority: [], email: [], linkedin: false, companies: [] };

/** Facet counts (over all people in the job) for the sidebar. */
export interface PeopleFacets {
  seniority: Record<string, number>;
  email: { has: number; valid: number; bad: number };
  linkedin: { has: number };
  companies: { name: string; count: number }[];
}

/**
 * A seed fed into a people-collect job. Company is always required. When
 * `firstName`/`lastName` are present the seed is a KNOWN person to enrich;
 * otherwise it is a company whose decision-makers we discover.
 */
export interface PeopleSeedInput {
  companyId?: string | null;
  company: string;
  firstName?: string;
  lastName?: string;
  location?: string;
  domain?: string | null;
  website?: string | null;
  linkedin?: string | null;
}

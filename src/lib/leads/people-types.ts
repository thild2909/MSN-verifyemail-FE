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
  // Company context copied from the source company at seed time, so people can
  // be filtered and displayed alongside their employer's data (all null for
  // CSV-imported enrich seeds, which have no resolved company behind them).
  companyEmployees?: string | null;
  companyIndustry?: string | null;
  companyPhone?: string | null;
  companyEmail?: string | null;
  // Extra contact fields, pre-filled from a CSV import (shown in the drawer).
  mobile?: string | null;
  twitter?: string | null;
  facebook?: string | null;
  photo?: string | null;
  headline?: string | null;
  department?: string | null;
  // Raw location parts from the CSV (location above is the combined display value).
  city?: string | null;
  state?: string | null;
  country?: string | null;
  // Rich company detail pre-filled from a CSV import (Apollo-style export).
  keywords?: string | null;
  companyLinkedin?: string | null;
  companyRevenue?: string | null; // annual revenue (prefers the "Clean" numeric column)
  companyFunding?: string | null; // total funding (prefers the "Clean" numeric column)
  companyTechnologies?: string | null;
  companyFoundedYear?: string | null;
  companySeoDescription?: string | null;
  companyShortDescription?: string | null;
  emailVerification: EmailVerification | null;
  llmVerification?: LlmVerdict | null; // DeepSeek founder↔company cross-check (opt-in)
  collection: CollectionAttempt[];
}

/** Find + verify already ran for this row (including a persisted miss). Hide Access email. */
export function emailLookupDone(p: CollectedPerson): boolean {
  return p.emailVerification != null;
}

/** Pattern/LLM guess that never confirmed a mailbox — show "Not found", not the fabricated address. */
export function isUnconfirmedEmail(p: CollectedPerson): boolean {
  const s = p.emailVerification?.status;
  if (s === "not_found") return true;
  if (s === "invalid" && p.emailKind !== "found") return true;
  return false;
}

export interface PeopleSummary {
  companies: number; // seed companies
  companiesWithPeople: number;
  rowsWithPeople: number; // enrich mode: imported rows (seeds) that resolved to a person
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
  /** Person ids a verify worker is actively handling right now (bulk or single). */
  verifyingPersonIds?: string[];
  totalCompanies: number;
  processedCompanies: number;
  progress: number; // 0-100
  summary: PeopleSummary;
  createdAt: string;
  completedAt?: string;
}

/** Faceted filter state for the People table sidebar. */
export interface PeopleFilters {
  email: string[]; // Email Status: has | valid | catch_all | risky | invalid | unverified | none
  titles: string[]; // Job Titles: title contains any (OR)
  seniority: string[]; // founder | c_level | president | vp | other
  linkedin: boolean; // must have a LinkedIn URL
  funded: boolean; // employer has a real funding figure
  companies: string[]; // company names to include (OR)
  locations: string[]; // person location contains any (OR)
  employees: string[]; // employer size buckets, see EMPLOYEE_BUCKETS (OR)
  industries: string[]; // employer industry (OR)
  minScore: number; // minimum match confidence 0-100 (0 = off)
}

export const EMPTY_PEOPLE_FILTERS: PeopleFilters = {
  email: [], titles: [], seniority: [], linkedin: false, funded: false, companies: [], locations: [], employees: [], industries: [], minScore: 0,
};

/** Total number of active constraints — shared so the panel badge and the
 *  toolbar badge stay in sync. */
export const countPeopleFilters = (f: PeopleFilters): number =>
  f.email.length + f.titles.length + f.seniority.length + (f.linkedin ? 1 : 0) + (f.funded ? 1 : 0) +
  f.companies.length + f.locations.length + f.employees.length + f.industries.length + (f.minScore > 0 ? 1 : 0);

/** True when the person's employer carries a real funding figure (not blank / 0). */
export function personHasFunding(p: Pick<CollectedPerson, "companyFunding">): boolean {
  const v = p.companyFunding?.trim();
  return !!v && !/^(0+(\.0+)?|\$?0)$/.test(v) && !/^(n\/?a|none|null|-)$/i.test(v);
}

/** Facet counts (over all people in the job) for the sidebar. */
export interface PeopleFacets {
  seniority: Record<string, number>;
  email: { has: number; valid: number; catch_all: number; risky: number; invalid: number; unverified: number; none: number };
  linkedin: { has: number };
  funded: { has: number };
  companies: { name: string; count: number }[];
  industries: { name: string; count: number }[];
  employees: Record<string, number>; // bucket value -> count
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
  companyEmployees?: string | null; // employer size, carried from the source company
  companyIndustry?: string | null; // employer industry, carried from the source company
  companyPhone?: string | null; // employer phone, carried from the source company
  companyEmail?: string | null; // employer contact email, carried from the source company
  // Optional PERSON fields pre-filled from a CSV import (Apollo-style export).
  // The crawl fills gaps (esp. a verified email) but never discards these.
  title?: string | null;
  seniority?: string | null; // raw CSV value (e.g. "C_suite", "VP") — normalized on apply
  email?: string | null;
  personLinkedin?: string | null; // the person's OWN LinkedIn profile URL
  mobile?: string | null;
  twitter?: string | null;
  facebook?: string | null;
  photo?: string | null;
  headline?: string | null;
  department?: string | null;
  // Raw location parts from the CSV (location above is the combined value).
  city?: string | null;
  state?: string | null;
  country?: string | null;
  // Rich company detail from a CSV import (Apollo-style export).
  keywords?: string | null;
  companyLinkedin?: string | null;
  companyRevenue?: string | null;
  companyFunding?: string | null;
  companyTechnologies?: string | null;
  companyFoundedYear?: string | null;
  companySeoDescription?: string | null;
  companyShortDescription?: string | null;
  // A full snapshot pulled from a saved list (import dedup). When present the row
  // is shown straight from this snapshot — no crawl, no re-verify.
  prefill?: CollectedPerson | null;
}

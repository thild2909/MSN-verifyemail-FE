/**
 * Pure people filter/facet/sort/pagination over an in-memory array — the
 * client-side twin of the server crawl store's getPeople(), so the /lists People
 * tab filters and sorts exactly like Find Leads. Mirrors the query logic in
 * `server/people-collect-store.ts` (kept in sync by hand); no server-only deps.
 */
import { employeeBucket } from "./collect-types";
import { personHasFunding, type CollectedPerson, type PeopleFacets } from "./people-types";

export interface PeopleQuery {
  page?: number; pageSize?: number; search?: string;
  email?: string[]; titles?: string[]; seniority?: string[]; linkedin?: boolean; funded?: boolean;
  companies?: string[]; locations?: string[]; employees?: string[]; industries?: string[]; minScore?: number;
  sort?: string;
}
export interface PeoplePage { people: CollectedPerson[]; total: number; page: number; pageSize: number; facets: PeopleFacets }

export type EmailStatusBucket = "none" | "unverified" | "valid" | "catch_all" | "risky" | "invalid";
export function emailStatusBucket(p: CollectedPerson): EmailStatusBucket {
  if (!p.email) return "none";
  const s = p.emailVerification?.status;
  if (!s) return "unverified";
  if (s === "valid") return "valid";
  if (s === "catch_all") return "catch_all";
  if (s === "invalid" || s === "disposable") return "invalid";
  if (s === "not_found") return "none";
  return "risky"; // risky | unknown | role
}

export function peopleFacets(all: CollectedPerson[]): PeopleFacets {
  const seniority: Record<string, number> = {};
  const email = { has: 0, valid: 0, catch_all: 0, risky: 0, invalid: 0, unverified: 0, none: 0 };
  const linkedin = { has: 0 };
  const funded = { has: 0 };
  const employees: Record<string, number> = {};
  const companyCounts = new Map<string, number>();
  const industryCounts = new Map<string, number>();
  for (const p of all) {
    seniority[p.seniority] = (seniority[p.seniority] ?? 0) + 1;
    if (p.email) email.has++;
    email[emailStatusBucket(p)]++;
    if (p.linkedin) linkedin.has++;
    if (personHasFunding(p)) funded.has++;
    companyCounts.set(p.company, (companyCounts.get(p.company) ?? 0) + 1);
    const eb = employeeBucket(p.companyEmployees);
    if (eb) employees[eb] = (employees[eb] ?? 0) + 1;
    const ind = p.companyIndustry ? String(p.companyIndustry).trim() : "";
    if (ind) industryCounts.set(ind, (industryCounts.get(ind) ?? 0) + 1);
  }
  const byCountDesc = (a: { count: number }, b: { count: number }) => b.count - a.count;
  const companies = [...companyCounts.entries()].map(([name, count]) => ({ name, count })).sort(byCountDesc).slice(0, 40);
  const industries = [...industryCounts.entries()].map(([name, count]) => ({ name, count })).sort(byCountDesc).slice(0, 40);
  return { seniority, email, linkedin, funded, companies, industries, employees };
}

export function queryPeople(all: CollectedPerson[], query: PeopleQuery = {}): PeoplePage {
  const {
    page = 1, pageSize = 25, search = "",
    email = [], titles = [], seniority = [], linkedin = false, funded = false,
    companies = [], locations = [], employees = [], industries = [], minScore = 0, sort = "",
  } = query;
  const facets = peopleFacets(all);

  const lower = (arr: string[]) => arr.map((s) => s.toLowerCase());
  const titleTerms = lower(titles);
  const locationTerms = lower(locations);

  let filtered = all;
  const q = search.trim().toLowerCase();
  if (q) filtered = filtered.filter((p) =>
    p.name.toLowerCase().includes(q) ||
    p.company.toLowerCase().includes(q) ||
    (p.title?.value ? String(p.title.value).toLowerCase().includes(q) : false));
  if (email.length) filtered = filtered.filter((p) => {
    const b = emailStatusBucket(p);
    return email.some((e) => (e === "has" ? !!p.email : e === "bad" ? b === "invalid" : e === b));
  });
  if (titleTerms.length) filtered = filtered.filter((p) => { const t = (p.title?.value ? String(p.title.value) : "").toLowerCase(); return titleTerms.some((x) => t.includes(x)); });
  if (seniority.length) filtered = filtered.filter((p) => seniority.includes(p.seniority));
  if (linkedin) filtered = filtered.filter((p) => !!p.linkedin);
  if (funded) filtered = filtered.filter((p) => personHasFunding(p));
  if (companies.length) filtered = filtered.filter((p) => companies.includes(p.company));
  if (locationTerms.length) filtered = filtered.filter((p) => { const loc = (p.location ?? "").toLowerCase(); return locationTerms.some((x) => loc.includes(x)); });
  if (employees.length) filtered = filtered.filter((p) => { const b = employeeBucket(p.companyEmployees); return b != null && employees.includes(b); });
  if (industries.length) filtered = filtered.filter((p) => p.companyIndustry != null && industries.includes(String(p.companyIndustry)));
  if (minScore > 0) filtered = filtered.filter((p) => p.confidence >= minScore);

  if (sort) {
    const desc = sort.endsWith("_desc");
    const field = desc ? sort.slice(0, -"_desc".length) : sort;
    const SENIORITY_RANK: Record<string, number> = { founder: 0, c_level: 1, president: 2, vp: 3, other: 4 };
    const valueOf = (p: CollectedPerson): string | number => {
      switch (field) {
        case "name": return p.name;
        case "title": return p.title?.value ? String(p.title.value) : "";
        case "email": return p.email?.value ? String(p.email.value) : "";
        case "company": return p.company;
        case "companyEmployees": { const n = parseInt(String(p.companyEmployees ?? "").replace(/[^0-9]/g, ""), 10); return Number.isFinite(n) ? n : NaN; }
        case "companyIndustry": return p.companyIndustry ?? "";
        case "seniority": return SENIORITY_RANK[p.seniority] ?? 99;
        case "companyPhone": return p.companyPhone ?? "";
        case "companyEmail": return p.companyEmail ?? "";
        case "linkedin": return p.linkedin ? 0 : 1;
        case "location": return p.location ?? "";
        default: return "";
      }
    };
    const isEmpty = (v: string | number) => v === "" || (typeof v === "number" && Number.isNaN(v));
    filtered = [...filtered].sort((a, b) => {
      const av = valueOf(a), bv = valueOf(b);
      if (isEmpty(av) && isEmpty(bv)) return 0;
      if (isEmpty(av)) return 1;
      if (isEmpty(bv)) return -1;
      const base = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
      return desc ? -base : base;
    });
  }

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  return { people: filtered.slice(start, start + pageSize), total, page, pageSize, facets };
}

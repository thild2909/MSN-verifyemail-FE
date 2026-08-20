/**
 * Find Leads — deterministic mock dataset + shared query engine.
 *
 * Everything here is generated from seeded hashes so the People / Companies /
 * Jobs tables are stable across renders and reloads. The headline stat numbers
 * (8.4K, 2.7M, …) are static labels representing the full index; the tables
 * operate on a realistic in-memory sample that filters/sorts/paginates live.
 */
import { seededRandom, initials } from "@/lib/utils";
import {
  COUNTRIES, DEPARTMENTS, EMPLOYEE_BANDS, EMPLOYMENT_TYPES, FUNDING_STAGES,
  INDUSTRIES, JOB_SENIORITIES, PEOPLE_SENIORITIES, TECHNOLOGIES, WORK_MODES,
  type Company, type Department, type EmailStatus, type EmployeeBand, type Industry,
  type Job, type Person, type PeopleFilters, type CompanyFilters, type JobFilters,
  type PeopleSeniority, type QualificationTier, type SortState, type HiringSignal,
} from "./types";

/* ------------------------------- rng helpers ----------------------------- */

const r = (seed: string) => seededRandom(seed);
const pick = <T>(arr: readonly T[], seed: string): T => arr[Math.floor(r(seed) * arr.length)];
const int = (seed: string, min: number, max: number) => min + Math.floor(r(seed) * (max - min + 1));
const chance = (seed: string, p: number) => r(seed) < p;

function sample<T>(arr: readonly T[], seed: string, min: number, max: number): T[] {
  const n = int(seed + ":n", min, max);
  const out: T[] = [];
  for (let i = 0; i < arr.length && out.length < n; i++) {
    if (chance(`${seed}:${i}`, 0.5)) out.push(arr[i]);
  }
  if (out.length === 0) out.push(pick(arr, seed + ":fallback"));
  return out;
}

/* --------------------------------- pools --------------------------------- */

const FIRST = ["Tom", "Chris", "Tengis", "Issey", "Sarah", "David", "Emily", "Michael", "Laura", "James", "Anna", "Robert", "Sofia", "Daniel", "Grace", "Liam", "Noah", "Olivia", "Mia", "Lucas"];
const LAST = ["Manderson", "Reay", "Batsaikhan", "Stevens", "Smith", "Lee", "Wong", "Brown", "Chen", "Davis", "Wilson", "Patel", "Garcia", "Muller", "Kim", "Rossi", "Nguyen", "Khan", "Silva", "Ito"];

const COMPANY_NAMES = [
  "Solara Health", "BigFuture", "Omniscient", "Intelligence Assist", "Africa Press",
  "Egger & Co", "Vegas Remotas", "Careerjoin", "Javel Cloud", "Mind AI", "FinTech Labs",
  "Northwind", "Cloudpeak", "DataForge", "Nimbus", "Quantile", "Brightline", "Vertex Systems",
  "Helio", "Corewave", "Lumen Bio", "Stackhouse", "Paystream", "Orbital", "Kestrel",
  "Meridian", "Fathom", "Beacon Labs", "Ironclad", "Wavelength",
];

const TITLES_BY_SENIORITY: Record<PeopleSeniority, string[]> = {
  c_level: ["CTO & Head of Engineering", "CTO / CIO", "Chief Technology Officer", "CEO & Cofounder", "CIO"],
  vp: ["VP of Engineering", "VP of Product", "VP of Sales"],
  director: ["IT Director", "Director of Engineering", "Head of AI and Engineering", "Head of Technology"],
  manager: ["Engineering Manager", "Head of AI Engineering", "IT Manager", "Product Manager"],
  staff: ["Senior Software Engineer", "AI Engineer", "Account Executive"],
};

const DEPT_BY_SENIORITY: Record<PeopleSeniority, Department> = {
  c_level: "engineering", vp: "engineering", director: "engineering", manager: "product", staff: "engineering",
};

const CITY_BY_COUNTRY: Record<string, string[]> = {
  Australia: ["Sydney", "Melbourne", "Brisbane"],
  "United States": ["San Francisco", "New York", "Austin"],
  "United Kingdom": ["London", "Manchester"],
  Germany: ["Berlin", "Munich"],
  Singapore: ["Singapore"],
  Canada: ["Toronto", "Vancouver"],
};

const REVENUE_BANDS = ["$1M-$5M", "$5M-$10M", "$10M-$50M", "$50M-$100M", "$100M+"];
const PERSON_INSIGHTS = [
  "Decision maker", "Engineering leadership", "Relevant industry", "Strong technology fit",
  "Recently promoted", "Active on LinkedIn", "Owns technical budget",
];
const COMPANY_REASONS = [
  "Matches target industry", "Hiring engineering roles", "Fits company-size criteria",
  "Strong technology signals", "Located in target market", "Recently funded", "Growing headcount",
];

/* ------------------------------- generators ------------------------------ */

const N_COMPANIES = 180;
const N_PEOPLE = 260;
const N_JOBS = 160;

function bandForEmployees(n: number): EmployeeBand {
  if (n <= 10) return "1-10";
  if (n <= 50) return "11-50";
  if (n <= 200) return "51-200";
  if (n <= 500) return "201-500";
  if (n <= 1000) return "501-1000";
  if (n <= 5000) return "1001-5000";
  return "5001+";
}

function tierForScore(score: number): QualificationTier {
  if (score >= 38) return "Excellent";
  if (score >= 28) return "Good";
  return "Fair";
}

function buildCompanies(): Company[] {
  return Array.from({ length: N_COMPANIES }, (_, i): Company => {
    const name = i < COMPANY_NAMES.length ? COMPANY_NAMES[i] : `${pick(COMPANY_NAMES, `c${i}`)} ${i}`;
    const s = `company:${i}`;
    const domain = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 14) + ".com";
    const employees = int(s + ":emp", 1, 4200);
    const country = pick(COUNTRIES, s + ":country");
    const city = pick(CITY_BY_COUNTRY[country], s + ":city");
    const industry = pick(INDUSTRIES, s + ":ind");

    const breakdown = {
      icpMatch: int(s + ":icp", 40, 99),
      companySize: int(s + ":size", 40, 99),
      industryMatch: int(s + ":indm", 40, 99),
      techFit: int(s + ":tech", 40, 99),
      hiringSignal: int(s + ":hire", 30, 99),
    };
    const avg = (breakdown.icpMatch + breakdown.companySize + breakdown.industryMatch + breakdown.techFit + breakdown.hiringSignal) / 5;
    const score = Math.round((avg / 100) * 50);

    return {
      id: `co_${i}`,
      name,
      domain,
      logoText: initials(name),
      employees,
      employeeBand: bandForEmployees(employees),
      industry,
      sic: String(int(s + ":sic", 1000, 9999)),
      naics: String(int(s + ":naics", 100000, 999999)),
      location: `${city}, ${country}`,
      country,
      city,
      website: domain,
      linkedinAvailable: chance(s + ":li", 0.85),
      revenue: pick(REVENUE_BANDS, s + ":rev"),
      foundedYear: int(s + ":founded", 1998, 2022),
      fundingStage: pick(FUNDING_STAGES, s + ":fund"),
      technologies: sample(TECHNOLOGIES, s + ":techs", 2, 5),
      keywords: sample(["AI", "SaaS", "B2B", "Platform", "Cloud", "Automation"], s + ":kw", 1, 3),
      qualification: {
        score,
        tier: tierForScore(score),
        breakdown,
        reasons: sample(COMPANY_REASONS, s + ":reasons", 3, 5),
      },
      companyScore: int(s + ":cscore", 40, 99),
      saved: chance(s + ":saved", 0.06),
      netNew: chance(s + ":new", 0.9),
    };
  });
}

function buildPeople(companies: Company[]): Person[] {
  return Array.from({ length: N_PEOPLE }, (_, i): Person => {
    const s = `person:${i}`;
    const firstName = pick(FIRST, s + ":f");
    const lastName = pick(LAST, s + ":l");
    const name = `${firstName} ${lastName}`;
    const seniority = pick(PEOPLE_SENIORITIES, s + ":sen");
    const jobTitle = pick(TITLES_BY_SENIORITY[seniority], s + ":title");
    const company = companies[int(s + ":co", 0, companies.length - 1)];
    const emailStatus = pick(["verified", "verified", "unverified", "unavailable"] as EmailStatus[], s + ":email");
    const local = `${firstName}.${lastName}`.toLowerCase();

    return {
      id: `pe_${i}`,
      name,
      firstName,
      lastName,
      jobTitle,
      seniority,
      department: DEPT_BY_SENIORITY[seniority],
      company: company.name,
      companyId: company.id,
      companyDomain: company.domain,
      companyLogoText: company.logoText,
      email: `${local}@${company.domain}`,
      emailStatus,
      phoneAvailable: chance(s + ":phone", 0.55),
      phone: chance(s + ":phone", 0.55) ? `+61 4${int(s + ":pn", 10, 99)} ${int(s + ":pn2", 100, 999)} ${int(s + ":pn3", 100, 999)}` : null,
      location: company.location,
      country: company.country,
      city: company.city,
      linkedinAvailable: chance(s + ":li", 0.8),
      companySize: company.employeeBand,
      industry: company.industry,
      technologies: company.technologies,
      icpScore: int(s + ":icp", 55, 99),
      insights: sample(PERSON_INSIGHTS, s + ":ins", 3, 4),
      saved: chance(s + ":saved", 0.04),
      netNew: chance(s + ":new", 0.92),
    };
  });
}

function buildJobs(companies: Company[]): Job[] {
  const JOB_TITLES = [
    "Senior AI Engineer", "Senior Data Engineer", "Machine Learning Engineer", "DevOps Engineer",
    "Engineering Manager", "Head of Engineering", "VP Engineering", "Software Engineer",
    "Platform Engineer", "Staff Engineer", "CTO",
  ];
  const signalByAge = (days: number): HiringSignal => (days <= 3 ? "strong" : days <= 10 ? "medium" : "weak");
  return Array.from({ length: N_JOBS }, (_, i): Job => {
    const s = `job:${i}`;
    const company = companies[int(s + ":co", 0, companies.length - 1)];
    const postedDaysAgo = int(s + ":posted", 0, 40);
    return {
      id: `jo_${i}`,
      title: pick(JOB_TITLES, s + ":title"),
      company: company.name,
      companyId: company.id,
      companyLogoText: company.logoText,
      location: company.location,
      country: company.country,
      city: company.city,
      workMode: pick(WORK_MODES, s + ":mode"),
      employmentType: pick(EMPLOYMENT_TYPES, s + ":emp"),
      postedDaysAgo,
      companySize: company.employeeBand,
      technologies: sample(TECHNOLOGIES, s + ":techs", 2, 4),
      hiringSignal: signalByAge(postedDaysAgo),
      seniority: pick(JOB_SENIORITIES, s + ":sen"),
      salaryMin: int(s + ":smin", 80, 160) * 1000,
      salaryMax: int(s + ":smax", 160, 260) * 1000,
      saved: chance(s + ":saved", 0.05),
      netNew: chance(s + ":new", 0.85),
    };
  });
}

/* ------------------------------ dataset (memo) --------------------------- */

let _companies: Company[] | null = null;
let _people: Person[] | null = null;
let _jobs: Job[] | null = null;

export function allCompanies(): Company[] {
  if (!_companies) _companies = buildCompanies();
  return _companies;
}
export function allPeople(): Person[] {
  if (!_people) _people = buildPeople(allCompanies());
  return _people;
}
export function allJobs(): Job[] {
  if (!_jobs) _jobs = buildJobs(allCompanies());
  return _jobs;
}

/* --------------------------------- stats --------------------------------- */

export const PEOPLE_STATS = { total: "8.4K", netNew: "8.2K" };
export const COMPANY_STATS = { total: "2.7M", netNew: "2.7M" };
export const JOB_STATS = { total: "124K", netNew: "18.4K" };

/* ------------------------------- query engine ---------------------------- */

export interface QueryResult<T> {
  rows: T[];
  total: number;
}

function sortRows<T>(rows: T[], sort: SortState | null, value: (row: T, key: string) => string | number): T[] {
  if (!sort) return rows;
  const out = [...rows].sort((a, b) => {
    const va = value(a, sort.key);
    const vb = value(b, sort.key);
    if (typeof va === "number" && typeof vb === "number") return va - vb;
    return String(va).localeCompare(String(vb));
  });
  return sort.dir === "desc" ? out.reverse() : out;
}

function page<T>(rows: T[], p: number, size: number): T[] {
  const start = (p - 1) * size;
  return rows.slice(start, start + size);
}

const some = <T>(sel: T[], val: T) => sel.length === 0 || sel.includes(val);

/* ---- people ---- */

export function queryPeople(f: PeopleFilters, sort: SortState | null, p: number, size: number): QueryResult<Person> {
  const q = f.search.trim().toLowerCase();
  let rows = allPeople().filter((row) => {
    if (q && !row.name.toLowerCase().includes(q) && !row.company.toLowerCase().includes(q) && !row.jobTitle.toLowerCase().includes(q) && !row.email.toLowerCase().includes(q)) return false;
    if (!some(f.emailStatus, row.emailStatus)) return false;
    if (f.jobTitles.length && !f.jobTitles.some((t) => row.jobTitle.toLowerCase().includes(t.toLowerCase()))) return false;
    if (f.excludedCompanies.some((c) => row.company.toLowerCase() === c.toLowerCase())) return false;
    if (!some(f.seniority, row.seniority)) return false;
    if (!some(f.departments, row.department)) return false;
    if (f.country !== "all" && row.country !== f.country) return false;
    if (!some(f.companySize, row.companySize)) return false;
    if (!some(f.industries, row.industry)) return false;
    if (f.technologies.length && !f.technologies.some((t) => row.technologies.includes(t))) return false;
    if (f.emailAvailable && row.emailStatus === "unavailable") return false;
    if (f.linkedinAvailable && !row.linkedinAvailable) return false;
    return true;
  });
  const total = rows.length;
  rows = sortRows(rows, sort, (row, key) => {
    switch (key) {
      case "name": return row.name;
      case "jobTitle": return row.jobTitle;
      case "company": return row.company;
      case "location": return row.location;
      case "icpScore": return row.icpScore;
      default: return row.name;
    }
  });
  return { rows: page(rows, p, size), total };
}

/* ---- companies ---- */

export function queryCompanies(f: CompanyFilters, sort: SortState | null, p: number, size: number): QueryResult<Company> {
  const q = f.search.trim().toLowerCase();
  let rows = allCompanies().filter((row) => {
    if (q && !row.name.toLowerCase().includes(q) && !row.domain.toLowerCase().includes(q)) return false;
    if (!some(f.industries, row.industry)) return false;
    if (!some(f.employeeBands, row.employeeBand)) return false;
    if (f.country !== "all" && row.country !== f.country) return false;
    if (f.technologies.length && !f.technologies.some((t) => row.technologies.includes(t))) return false;
    if (!some(f.fundingStages, row.fundingStage)) return false;
    if (f.keywords.length && !f.keywords.some((k) => row.keywords.includes(k))) return false;
    if (row.qualification.score * 2 < f.minScore) return false; // score is /50 → compare on /100
    if (!some(f.tiers, row.qualification.tier)) return false;
    return true;
  });
  const total = rows.length;
  rows = sortRows(rows, sort, (row, key) => {
    switch (key) {
      case "name": return row.name;
      case "employees": return row.employees;
      case "qualification": return row.qualification.score;
      case "companyScore": return row.companyScore;
      case "industry": return row.industry;
      case "location": return row.location;
      default: return row.qualification.score;
    }
  });
  return { rows: page(rows, p, size), total };
}

/* ---- jobs ---- */

export function queryJobs(f: JobFilters, sort: SortState | null, p: number, size: number): QueryResult<Job> {
  const q = f.search.trim().toLowerCase();
  let rows = allJobs().filter((row) => {
    if (q && !row.title.toLowerCase().includes(q) && !row.company.toLowerCase().includes(q)) return false;
    if (f.titles.length && !f.titles.some((t) => row.title.toLowerCase().includes(t.toLowerCase()))) return false;
    if (!some(f.workModes, row.workMode)) return false;
    if (!some(f.employmentTypes, row.employmentType)) return false;
    if (!some(f.seniority, row.seniority)) return false;
    if (f.postedWithinDays > 0 && row.postedDaysAgo > f.postedWithinDays) return false;
    if (f.country !== "all" && row.country !== f.country) return false;
    if (f.technologies.length && !f.technologies.some((t) => row.technologies.includes(t))) return false;
    if (!some(f.companySizes, row.companySize)) return false;
    if (!some(f.hiringSignals, row.hiringSignal)) return false;
    if (f.salaryMin > 0 && row.salaryMax < f.salaryMin) return false;
    return true;
  });
  const total = rows.length;
  rows = sortRows(rows, sort, (row, key) => {
    switch (key) {
      case "title": return row.title;
      case "company": return row.company;
      case "posted": return row.postedDaysAgo;
      case "location": return row.location;
      default: return row.postedDaysAgo;
    }
  });
  return { rows: page(rows, p, size), total };
}

/* -------------------------------- helpers -------------------------------- */

export function postedLabel(days: number): string {
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 30) return `${Math.round(days / 7)} weeks ago`;
  return "30+ days ago";
}

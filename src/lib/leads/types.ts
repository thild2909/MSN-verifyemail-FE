/**
 * Find Leads — shared data model for the People / Companies / Jobs tabs.
 *
 * People, Companies and Jobs deliberately share the same filter/sort/column
 * infrastructure so the table, sidebar and bulk-action components are reused
 * across all three tabs. All data is deterministic mock (see ./data.ts).
 */

export type LeadsTab = "people" | "companies" | "jobs";

/* ------------------------------- shared enums ---------------------------- */

export const EMAIL_STATUSES = ["verified", "unverified", "unavailable"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const PEOPLE_SENIORITIES = ["c_level", "vp", "director", "manager", "staff"] as const;
export type PeopleSeniority = (typeof PEOPLE_SENIORITIES)[number];

export const DEPARTMENTS = [
  "engineering", "product", "sales", "marketing", "operations", "hr", "finance",
] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const EMPLOYEE_BANDS = [
  "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001+",
] as const;
export type EmployeeBand = (typeof EMPLOYEE_BANDS)[number];

export const INDUSTRIES = [
  "FinTech", "Healthcare", "Software", "E-commerce", "Cybersecurity",
  "Information Services", "Logistics", "Education", "Real Estate", "Marketing",
] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const TECHNOLOGIES = [
  "AWS", "Python", "React", "LLM", "Spark", "Kubernetes", "Node.js", "Snowflake",
  "TypeScript", "GCP", "PostgreSQL", "TensorFlow",
] as const;

export const FUNDING_STAGES = ["Seed", "Series A", "Series B", "Series C", "Public"] as const;
export type FundingStage = (typeof FUNDING_STAGES)[number];

export const COUNTRIES = [
  "Australia", "United States", "United Kingdom", "Germany", "Singapore", "Canada",
] as const;

export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "internship"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const JOB_SENIORITIES = [
  "entry", "mid", "senior", "lead", "manager", "director", "vp", "c_level",
] as const;
export type JobSeniority = (typeof JOB_SENIORITIES)[number];

export type QualificationTier = "Excellent" | "Good" | "Fair";
export type HiringSignal = "strong" | "medium" | "weak";

/* --------------------------------- records ------------------------------- */

export interface Person {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  seniority: PeopleSeniority;
  department: Department;
  company: string;
  companyId: string;
  companyDomain: string;
  companyLogoText: string;
  email: string;
  emailStatus: EmailStatus;
  phoneAvailable: boolean;
  phone: string | null;
  location: string;
  country: string;
  city: string;
  linkedinAvailable: boolean;
  companySize: EmployeeBand;
  industry: Industry;
  technologies: string[];
  icpScore: number; // 0-100
  insights: string[];
  saved: boolean;
  netNew: boolean;
}

export interface AIQualification {
  score: number; // 0-50
  tier: QualificationTier;
  breakdown: { icpMatch: number; companySize: number; industryMatch: number; techFit: number; hiringSignal: number };
  reasons: string[];
}

export interface Company {
  id: string;
  name: string;
  domain: string;
  logoText: string;
  employees: number;
  employeeBand: EmployeeBand;
  industry: Industry;
  sic: string;
  naics: string;
  location: string;
  country: string;
  city: string;
  website: string;
  linkedinAvailable: boolean;
  revenue: string;
  foundedYear: number;
  fundingStage: FundingStage;
  technologies: string[];
  keywords: string[];
  qualification: AIQualification;
  companyScore: number; // 0-100
  saved: boolean;
  netNew: boolean;
}

export interface Job {
  id: string;
  title: string;
  company: string;
  companyId: string;
  companyLogoText: string;
  location: string;
  country: string;
  city: string;
  workMode: WorkMode;
  employmentType: EmploymentType;
  postedDaysAgo: number;
  companySize: EmployeeBand;
  technologies: string[];
  hiringSignal: HiringSignal;
  seniority: JobSeniority;
  salaryMin: number;
  salaryMax: number;
  saved: boolean;
  netNew: boolean;
}

/* --------------------------------- filters ------------------------------- */

export interface PeopleFilters {
  search: string;
  emailStatus: EmailStatus[];
  jobTitles: string[]; // include
  excludedCompanies: string[];
  seniority: PeopleSeniority[];
  departments: Department[];
  country: string; // "all" | value
  companySize: EmployeeBand[];
  industries: Industry[];
  technologies: string[];
  emailAvailable: boolean;
  linkedinAvailable: boolean;
}

export interface CompanyFilters {
  search: string;
  industries: Industry[];
  employeeBands: EmployeeBand[];
  country: string;
  technologies: string[];
  fundingStages: FundingStage[];
  keywords: string[];
  minScore: number; // 0-100
  tiers: QualificationTier[];
}

export interface JobFilters {
  search: string;
  titles: string[];
  workModes: WorkMode[];
  employmentTypes: EmploymentType[];
  seniority: JobSeniority[];
  postedWithinDays: number; // 0 = any
  country: string;
  technologies: string[];
  companySizes: EmployeeBand[];
  hiringSignals: HiringSignal[];
  salaryMin: number; // 0 = any (annual, USD)
}

/* ----------------------------- sort + columns ---------------------------- */

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}

export interface ColumnDef {
  key: string;
  label: string;
  defaultVisible: boolean;
  sortable?: boolean;
  /** Right-align (numeric) columns. */
  numeric?: boolean;
}

export interface StatBlock {
  total: string;
  netNew: string;
  savedKey: "saved";
}

/* --------------------------- default filter state ------------------------ */

export const DEFAULT_PEOPLE_FILTERS: PeopleFilters = {
  search: "",
  emailStatus: [],
  jobTitles: [],
  excludedCompanies: [],
  seniority: [],
  departments: [],
  country: "all",
  companySize: [],
  industries: [],
  technologies: [],
  emailAvailable: false,
  linkedinAvailable: false,
};

export const DEFAULT_COMPANY_FILTERS: CompanyFilters = {
  search: "",
  industries: [],
  employeeBands: [],
  country: "all",
  technologies: [],
  fundingStages: [],
  keywords: [],
  minScore: 0,
  tiers: [],
};

export const DEFAULT_JOB_FILTERS: JobFilters = {
  search: "",
  titles: [],
  workModes: [],
  employmentTypes: [],
  seniority: [],
  postedWithinDays: 0,
  country: "all",
  technologies: [],
  companySizes: [],
  hiringSignals: [],
  salaryMin: 0,
};

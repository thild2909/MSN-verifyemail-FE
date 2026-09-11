/**
 * Pure normalization + scoring helpers for the LinkedIn Job Scraper pipeline
 * (Parse & Normalize / Enrich & Score steps). No server-only deps so the store
 * and UI can both use them. Mirrors the parsing intent of the BE scraper but
 * owns the FE-side canonical shape.
 */
import type { CollectedLinkedInJob, LinkedInScrapeParams } from "./linkedin-jobs-types";

const REMOTE_RE = /\bremote\b/i;
const CITY_STATES = new Set(["singapore", "hong kong", "dubai", "monaco", "luxembourg", "macau", "qatar"]);
const txt = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export interface NormalizedLocation { country: string | null; city: string | null; remote: boolean; }

/** "Singapore · Remote" / "Central Region, Singapore" → {country, city, remote}. */
export function normalizeLocation(raw: string | null): NormalizedLocation {
  if (!raw) return { country: null, city: null, remote: false };
  const remote = REMOTE_RE.test(raw);
  const cleaned = raw.split(/[·|]/).map(txt).filter((s) => s && !REMOTE_RE.test(s)).join(", ");
  const parts = cleaned.split(",").map(txt).filter(Boolean);
  if (parts.length === 0) return { country: null, city: null, remote };
  if (parts.length === 1) {
    const only = parts[0];
    if (CITY_STATES.has(only.toLowerCase())) return { country: only, city: only, remote };
    return { country: only, city: null, remote };
  }
  return { country: parts[parts.length - 1], city: parts[0], remote };
}

const LANG_RULES: Array<[RegExp, string]> = [
  [/\bpython\b/i, "Python"], [/\b(php|laravel|symfony)\b/i, "PHP"], [/\b(java|spring)\b/i, "Java"],
  [/\b(golang|\bgo\b)\b/i, "Go"], [/\b(node|javascript|typescript|react|vue|angular)\b/i, "JavaScript/TypeScript"],
  [/\bc#|\.net\b/i, "C#/.NET"], [/\b(ruby|rails)\b/i, "Ruby"], [/\brust\b/i, "Rust"],
  [/\bkotlin\b/i, "Kotlin"], [/\bswift\b/i, "Swift"], [/\bscala\b/i, "Scala"],
];

const ROLE_RULES: Array<[RegExp, string]> = [
  [/\b(front.?end|ui engineer)\b/i, "Frontend Engineer"],
  [/\b(back.?end|api engineer)\b/i, "Backend Engineer"],
  [/\bfull.?stack\b/i, "Fullstack Engineer"],
  [/\b(devops|sre|site reliability|platform engineer|infrastructure)\b/i, "DevOps / SRE"],
  [/\b(data engineer|etl)\b/i, "Data Engineer"],
  [/\b(machine learning|ml engineer|deep learning|nlp)\b/i, "ML / AI Engineer"],
  [/\b(data scien)/i, "Data Scientist"],
  [/\b(data analyst|business intelligence)\b/i, "Data Analyst"],
  [/\b(mobile|android|ios|flutter|react native)\b/i, "Mobile Engineer"],
  [/\b(qa|test engineer|sdet|quality assurance)\b/i, "QA Engineer"],
  [/\b(security|infosec|appsec|cyber)\b/i, "Security Engineer"],
  [/\b(cloud|aws|azure|gcp)\b/i, "Cloud Engineer"],
  [/\b(engineering manager|tech lead|team lead)\b/i, "Engineering Manager"],
  [/\b(software|developer|engineer|programmer)\b/i, "Software Engineer"],
];

const SENIORITY_RULES: Array<[RegExp, string]> = [
  [/\b(intern|internship|trainee)\b/i, "Intern"],
  [/\b(principal|staff|distinguished)\b/i, "Principal / Staff"],
  [/\b(director|head of|vp|vice president|chief|cto)\b/i, "Director+"],
  [/\b(lead|manager)\b/i, "Lead / Manager"],
  [/\b(senior|sr\.?|snr)\b/i, "Senior"],
  [/\b(junior|jr\.?|entry|graduate|associate)\b/i, "Junior"],
];

function firstMatch(rules: Array<[RegExp, string]>, s: string): string | null {
  for (const [re, val] of rules) if (re.test(s)) return val;
  return null;
}

export interface NormalizedTitle { roleFamily: string | null; primaryLanguage: string | null; seniorityLevel: string | null; }

export function normalizeTitle(title: string): NormalizedTitle {
  const s = title || "";
  return {
    // Never empty: fall back to "Other" so the Role column always has a value.
    roleFamily: firstMatch(ROLE_RULES, s) ?? "Other",
    primaryLanguage: firstMatch(LANG_RULES, s),
    seniorityLevel: firstMatch(SENIORITY_RULES, s) ?? "Mid",
  };
}

/** Days since a posting from its ISO date (preferred) or free text ("2 days ago"). */
export function postedDaysAgo(postedAt: string | null, postedText: string | null): number | null {
  if (postedAt) {
    const d = Date.parse(postedAt);
    if (Number.isFinite(d)) return Math.max(0, Math.round((Date.now() - d) / 86_400_000));
  }
  const s = (postedText ?? "").toLowerCase();
  if (!s) return null;
  if (/just now|today|hour|minute/.test(s)) return 0;
  if (/yesterday/.test(s)) return 1;
  const m = s.match(/(\d+)\s*(day|week|month|year)/);
  if (m) {
    const n = Number(m[1]);
    return { day: n, week: n * 7, month: n * 30, year: n * 365 }[m[2] as "day" | "week" | "month" | "year"] ?? null;
  }
  return null;
}

/**
 * Apply the qualification gate (Filter step 5 + company criteria from step 6).
 * Returns the qualified flag + the FIRST failing reason. `companyKnown` gates
 * the employee/industry checks: before the enrich pass they are unknown, so we
 * don't reject on missing company data.
 */
export function qualifyJob(
  job: CollectedLinkedInJob,
  params: LinkedInScrapeParams,
  companyKnown: boolean,
): { qualified: boolean; rejectReason: string | null } {
  if (params.targetRoles.length && (!job.roleFamily || !params.targetRoles.includes(job.roleFamily))) {
    return { qualified: false, rejectReason: "role not targeted" };
  }
  if (params.maxAgeDays > 0 && job.postedDaysAgo != null && job.postedDaysAgo > params.maxAgeDays) {
    return { qualified: false, rejectReason: `older than ${params.maxAgeDays}d` };
  }
  if (companyKnown) {
    if (params.employeeMax > 0 && job.companyEmployeeMin != null && job.companyEmployeeMin > params.employeeMax) {
      return { qualified: false, rejectReason: `company > ${params.employeeMax} employees` };
    }
    if (params.targetIndustries.length && job.companyIndustry) {
      const ind = job.companyIndustry.toLowerCase();
      if (!params.targetIndustries.some((t) => ind.includes(t.toLowerCase()))) {
        return { qualified: false, rejectReason: "industry not targeted" };
      }
    }
  }
  return { qualified: true, rejectReason: null };
}

/** 0-100 fit score. Recency + role match + seniority weight, plus company size/
 *  industry fit once enriched. Deterministic; higher = better lead. */
export function scoreJob(job: CollectedLinkedInJob, params: LinkedInScrapeParams): number {
  let s = 40;
  // recency
  if (job.postedDaysAgo != null) {
    if (job.postedDaysAgo <= 1) s += 20;
    else if (job.postedDaysAgo <= 7) s += 14;
    else if (job.postedDaysAgo <= 30) s += 6;
  }
  // role match
  if (job.roleFamily) s += params.targetRoles.length && params.targetRoles.includes(job.roleFamily) ? 15 : 8;
  // seniority (senior+ roles = stronger technical hiring signal)
  if (job.seniorityLevel && /senior|principal|staff|lead|manager|director/i.test(job.seniorityLevel)) s += 6;
  // company size — reward being within the target cap when one is set.
  if (job.companyEmployeeMin != null) {
    if (params.employeeMax > 0) {
      if (job.companyEmployeeMin <= params.employeeMax) s += 12;
    } else if (job.companyEmployeeMin >= 11) s += 6;
  }
  // industry fit
  if (job.companyIndustry && params.targetIndustries.length) {
    const ind = job.companyIndustry.toLowerCase();
    if (params.targetIndustries.some((t) => ind.includes(t.toLowerCase()))) s += 7;
  }
  return Math.max(0, Math.min(100, Math.round(s)));
}

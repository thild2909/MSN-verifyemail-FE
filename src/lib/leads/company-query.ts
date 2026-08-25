/**
 * Pure company filter/facet/pagination over an in-memory array — the client-side
 * twin of the server crawl store's getCompanies(), so the /lists Company tab
 * filters exactly like Find Leads. Mirrors `server/company-collect-store.ts`
 * (kept in sync by hand); no server-only deps so it runs in the browser.
 */
import { employeeBucket, type CollectedCompany, type CompaniesFacets } from "./collect-types";

export interface CompaniesQuery {
  page?: number; pageSize?: number; search?: string;
  company?: string[]; locations?: string[]; employees?: string[]; industries?: string[]; technologies?: string[];
  status?: string[]; has?: string[]; email?: string[];
}
export interface CompaniesPage { companies: CollectedCompany[]; total: number; page: number; pageSize: number; facets: CompaniesFacets }

const isBadEmailCo = (c: CollectedCompany) => c.emailVerification != null && ["invalid", "disposable"].includes(c.emailVerification.status);

export function companiesFacets(all: CollectedCompany[]): CompaniesFacets {
  const status: Record<string, number> = {};
  const has = { website: 0, email: 0, phone: 0, linkedin: 0 };
  const email = { valid: 0, bad: 0 };
  const employees: Record<string, number> = {};
  const industryCounts = new Map<string, number>();
  const techCounts = new Map<string, number>();
  for (const c of all) {
    status[c.status] = (status[c.status] ?? 0) + 1;
    if (c.website) has.website++;
    if (c.contactEmail) has.email++;
    if (c.phone) has.phone++;
    if (c.linkedin) has.linkedin++;
    if (c.emailVerification?.status === "valid") email.valid++;
    if (isBadEmailCo(c)) email.bad++;
    const eb = employeeBucket(c.employees?.value);
    if (eb) employees[eb] = (employees[eb] ?? 0) + 1;
    const ind = c.industry?.value ? String(c.industry.value) : "";
    if (ind) industryCounts.set(ind, (industryCounts.get(ind) ?? 0) + 1);
    for (const t of c.technologies?.value ?? []) {
      const name = String(t).trim();
      if (name) techCounts.set(name, (techCounts.get(name) ?? 0) + 1);
    }
  }
  const byCountDesc = (a: { count: number }, b: { count: number }) => b.count - a.count;
  const industries = [...industryCounts.entries()].map(([name, count]) => ({ name, count })).sort(byCountDesc).slice(0, 40);
  const technologies = [...techCounts.entries()].map(([name, count]) => ({ name, count })).sort(byCountDesc).slice(0, 40);
  return { status, has, email, industries, technologies, employees };
}

export function queryCompanies(all: CollectedCompany[], query: CompaniesQuery = {}): CompaniesPage {
  const {
    page = 1, pageSize = 25, search = "",
    company = [], locations = [], employees = [], industries = [], technologies = [],
    status = [], has = [], email = [],
  } = query;
  const facets = companiesFacets(all);

  const lower = (arr: string[]) => arr.map((s) => s.toLowerCase());
  const companyTerms = lower(company);
  const locationTerms = lower(locations);
  const techTerms = lower(technologies);

  const companyLocation = (c: CollectedCompany) =>
    (c.address?.value ? String(c.address.value) : c.inputLocation).toLowerCase();

  let filtered = all;
  const q = search.trim().toLowerCase();
  if (q) filtered = filtered.filter((c) => c.inputName.toLowerCase().includes(q) || c.inputLocation.toLowerCase().includes(q) || (c.domainGuess ?? "").includes(q));
  if (companyTerms.length) filtered = filtered.filter((c) => { const n = c.inputName.toLowerCase(); return companyTerms.some((t) => n.includes(t)); });
  if (locationTerms.length) filtered = filtered.filter((c) => { const loc = companyLocation(c); return locationTerms.some((t) => loc.includes(t)); });
  if (employees.length) filtered = filtered.filter((c) => { const b = employeeBucket(c.employees?.value); return b != null && employees.includes(b); });
  if (industries.length) filtered = filtered.filter((c) => c.industry?.value != null && industries.includes(String(c.industry.value)));
  if (techTerms.length) filtered = filtered.filter((c) => { const techs = (c.technologies?.value ?? []).map((x) => String(x).toLowerCase()); return techTerms.some((t) => techs.includes(t)); });
  if (status.length) filtered = filtered.filter((c) => status.includes(c.status));
  if (has.length) filtered = filtered.filter((c) => has.every((h) =>
    h === "website" ? !!c.website : h === "email" ? !!c.contactEmail : h === "phone" ? !!c.phone : h === "linkedin" ? !!c.linkedin : true));
  if (email.length) filtered = filtered.filter((c) => email.some((e) =>
    e === "valid" ? c.emailVerification?.status === "valid" : e === "bad" ? isBadEmailCo(c) : false));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  return { companies: filtered.slice(start, start + pageSize), total, page, pageSize, facets };
}

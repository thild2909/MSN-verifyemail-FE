/**
 * Build the persisted snapshot for Find Leads "Save" / "Add to list".
 *
 * The full crawler row goes into `data` (so the Lists screen keeps working after
 * the in-memory crawler jobs are gone); a few fields are lifted to top-level
 * columns for display and search on the server.
 */
import type { NewLeadItem } from "@/lib/api/client";
import type { CollectedCompany } from "@/lib/leads/collect-types";
import type { CollectedPerson } from "@/lib/leads/people-types";
import { formatNumber } from "@/lib/utils";

/**
 * Build the toast for an "Add to list" / "New list" result so People and Companies
 * report duplicates the same way. `skipped` are rows already in the list (duplicate
 * by ref or by identity — see the leads store), which the backend silently drops.
 */
export function addToListToast(
  added: number,
  skipped: number,
  listName: string,
): { variant: "success" | "info"; title: string; description?: string } {
  if (added === 0 && skipped > 0) {
    return {
      variant: "info",
      title: `Already in ${listName}`,
      description: `${formatNumber(skipped)} ${skipped === 1 ? "row was" : "rows were"} already in the list.`,
    };
  }
  return {
    variant: "success",
    title: `Added ${formatNumber(added)} to ${listName}`,
    description: skipped > 0 ? `${formatNumber(skipped)} skipped (already in the list).` : undefined,
  };
}

export function companyToLeadItem(c: CollectedCompany, jobId: string): NewLeadItem {
  return {
    kind: "company",
    refId: c.id,
    jobId,
    name: c.inputName,
    company: c.inputName,
    title: c.industry?.value ?? null,
    email: c.contactEmail?.value ?? null,
    data: c as unknown as Record<string, unknown>,
  };
}

/** Employer fields lifted from a job / LinkedIn-job row. */
export interface JobCompanyInput {
  name: string;
  location?: string | null;
  domain?: string | null;
  website?: string | null;
  linkedin?: string | null;
  industry?: string | null;
  employees?: string | null;
  logoText?: string | null;
}

/**
 * Build a **company** lead item from a job's employer. Jobs carry far less than
 * a full company crawl, so most CollectedCompany fields are null; whatever the
 * job knows (name, location, domain/website, LinkedIn, industry, employees) is
 * lifted into the snapshot so the Lists → Company view still renders it. The
 * refId is the normalised company name so re-adding the same employer — from
 * another role, tab or list — is silently deduped by the leads store.
 */
export function jobCompanyToLeadItem(c: JobCompanyInput, jobId: string): NewLeadItem {
  const name = c.name.trim();
  const key = `co:${name.toLowerCase()}`;
  const src = (v: string | null | undefined) =>
    v && v.trim() ? { value: v.trim(), source: "linkedin", confidence: 60 } : null;
  const company: Record<string, unknown> = {
    id: key,
    jobId,
    inputName: name,
    inputLocation: (c.location ?? "").trim(),
    domainGuess: (c.domain ?? "").trim(),
    logoText: c.logoText?.trim() || name.slice(0, 2).toUpperCase(),
    status: "enriched",
    resolution: null,
    website: src(c.website),
    emailDomain: null,
    contactEmail: null,
    phone: null,
    linkedin: src(c.linkedin),
    twitter: null,
    facebook: null,
    address: null,
    mapsRating: null,
    industry: src(c.industry),
    employees: src(c.employees),
    revenue: null,
    founded: null,
    description: null,
    technologies: null,
    legalName: null,
    jurisdiction: null,
    registrationNumber: null,
    incorporated: null,
    emailVerification: null,
    collection: [],
  };
  return {
    kind: "company",
    refId: key,
    jobId,
    name,
    company: name,
    title: c.industry?.trim() || null,
    email: null,
    data: company,
  };
}

/** Dedupe a set of employers (by name) into company lead items. */
export function jobsToCompanyLeadItems(
  companies: JobCompanyInput[],
  jobId: string,
): NewLeadItem[] {
  const byName = new Map<string, NewLeadItem>();
  for (const c of companies) {
    const name = c.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (byName.has(key)) continue;
    byName.set(key, jobCompanyToLeadItem(c, jobId));
  }
  return [...byName.values()];
}

export function personToLeadItem(p: CollectedPerson, jobId: string): NewLeadItem {
  return {
    kind: "person",
    refId: p.id,
    jobId,
    name: p.name,
    company: p.company,
    title: p.title?.value ?? null,
    email: p.email?.value ?? p.emailVerification?.email ?? null,
    data: p as unknown as Record<string, unknown>,
  };
}

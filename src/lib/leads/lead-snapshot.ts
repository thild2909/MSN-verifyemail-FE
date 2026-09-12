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
import type { AiReportColumn } from "@/lib/leads/ai-report-columns";
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

/**
 * Columns that are identity/ordinal or already promoted to first-class company
 * fields — excluded from the dynamic AI-report snapshot to avoid clutter.
 */
const AI_REPORT_SKIP_KEYS = new Set(["rank", "company", "name"]);

/**
 * Turn an AI-report table (dynamic columns + rows from the "Find with AI" tab)
 * into deduped **company** lead items.
 *
 * The known columns (name, location, website, type, employees, LinkedIn) are
 * lifted into the CollectedCompany snapshot so the saved Company view/filters
 * keep working. Every other column the model returned — company type, hiring
 * role, job location, posting date, direct job source, growth signal, MSN fit,
 * verification notes, plus any custom extras — is captured in the STRUCTURED
 * `aiReport` field (a queryable key→value map + display labels), persisted
 * server-side in its own `ai_report` jsonb column and shown in the detail drawer.
 */
export function aiReportToCompanyLeadItems(
  columns: AiReportColumn[],
  rows: Record<string, string>[],
  meta?: { model?: string; generatedAt?: string },
): NewLeadItem[] {
  const byName = new Map<string, NewLeadItem>();
  const generatedAt = meta?.generatedAt ?? new Date().toISOString();
  for (const r of rows) {
    const name = (r.company ?? r.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (byName.has(key)) continue;

    const item = jobCompanyToLeadItem(
      {
        name,
        // A company's own location is its country; the "location" column is the
        // job's location, which we keep in the AI-report values below.
        location: r.country ?? r.location ?? null,
        website: r.website ?? null,
        industry: r.type ?? r.industry ?? null,
        employees: r.employees ?? null,
        linkedin: r.linkedin ?? null,
      },
      "ai-report",
    );

    const values: Record<string, string> = {};
    const labels: Record<string, string> = {};
    for (const c of columns) {
      if (AI_REPORT_SKIP_KEYS.has(c.key)) continue;
      const value = (r[c.key] ?? "").trim();
      if (!value || value === "—") continue;
      values[c.key] = value;
      labels[c.key] = c.label;
    }

    if (Object.keys(values).length) {
      item.aiReport = { model: meta?.model, generatedAt, values, labels };
    }
    byName.set(key, item);
  }
  return [...byName.values()];
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

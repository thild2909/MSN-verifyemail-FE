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

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

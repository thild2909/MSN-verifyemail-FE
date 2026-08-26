/**
 * Find Leads — shared pure helpers.
 *
 * This file previously held a large deterministic MOCK dataset (fake people /
 * companies / jobs and their query engines) used to prototype the Find Leads
 * tabs. All of that has been removed: every tab now reads real data from the
 * backend (people/company/job collection via the crawler-service, saved lists
 * from Postgres). Nothing here fabricates data.
 */

/** Human-readable "posted N days ago" label for a job's age in days. */
export function postedLabel(days: number): string {
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 30) return `${Math.round(days / 7)} weeks ago`;
  return "30+ days ago";
}

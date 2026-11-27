import type { CreditOperation } from "./types";

/**
 * Credit pricing shown in the UI (single source of truth for display).
 * Actual credit debits are computed and enforced server-side by BE-service.
 */
export const CREDIT_COSTS: Record<Exclude<CreditOperation, "top_up">, number> = {
  single_verification: 1,
  bulk_verification: 1, // per email
  deep_scan: 2, // per email
  email_finder: 1, // per search result surfaced
  api_verification: 1, // per request
};

export const UPLOAD_LIMITS = {
  maxFileSizeMb: 25,
  maxRows: 1_000_000,
  supportedFormats: ["CSV", "XLSX", "TXT"] as const,
};

export function estimateCredits(
  operation: keyof typeof CREDIT_COSTS,
  units: number,
): number {
  return CREDIT_COSTS[operation] * units;
}

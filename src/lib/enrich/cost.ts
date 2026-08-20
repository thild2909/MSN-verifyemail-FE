import { CREDIT_COSTS } from "@/lib/credit-config";
import { columnSpec } from "./columns";
import type { EnrichColumn, EnrichColumnKind } from "@/lib/types";

/**
 * Credit estimate for enrichment. Charged per cell actually run — one
 * `email_finder` credit unit per column's `costPerRow`, times the number of
 * rows. Shared by the UI (shown before a run) and the server (the credit gate).
 */
export function estimateColumnCredits(rowCount: number, kind: EnrichColumnKind): number {
  return CREDIT_COSTS.email_finder * columnSpec(kind).costPerRow * rowCount;
}

export function estimateTableCredits(rowCount: number, columns: Pick<EnrichColumn, "costPerRow">[]): number {
  const perRow = columns.reduce((sum, c) => sum + c.costPerRow, 0);
  return CREDIT_COSTS.email_finder * perRow * rowCount;
}

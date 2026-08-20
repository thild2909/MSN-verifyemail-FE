/**
 * Catalog of enrichment columns (the "providers" a Clay/Apollo table can run).
 * Shared by the add-enrichment menu (client) and the engine + credit gate
 * (server) so names, costs and availability are defined once.
 */
import type { EnrichColumnKind, EnrichRecordType } from "@/lib/types";

export interface ColumnSpec {
  kind: EnrichColumnKind;
  name: string;
  description: string;
  costPerRow: number;
  recordTypes: EnrichRecordType[];
  /** Resolved to a lucide icon in the UI (see enrich-ui). */
  iconKey: string;
}

export const COLUMN_CATALOG: ColumnSpec[] = [
  { kind: "find_work_email", name: "Work Email", description: "Email waterfall — finds & scores the best deliverable address.", costPerRow: 1, recordTypes: ["people"], iconKey: "mail-search" },
  { kind: "verify_email", name: "Verify Email", description: "SMTP-verify an email from a prior column or your import.", costPerRow: 1, recordTypes: ["people"], iconKey: "badge-check" },
  { kind: "find_phone", name: "Mobile Phone", description: "Find a direct / mobile number.", costPerRow: 1, recordTypes: ["people"], iconKey: "phone" },
  { kind: "find_linkedin", name: "LinkedIn URL", description: "Resolve the LinkedIn profile / company URL.", costPerRow: 1, recordTypes: ["people", "companies"], iconKey: "linkedin" },
  { kind: "enrich_company", name: "Company Data", description: "Firmographics from the domain — industry, size, location, revenue.", costPerRow: 1, recordTypes: ["people", "companies"], iconKey: "building" },
  { kind: "company_tech", name: "Technologies", description: "Technographics — the stack the company uses.", costPerRow: 1, recordTypes: ["people", "companies"], iconKey: "cpu" },
  { kind: "generic_emails", name: "Generic Emails", description: "Role mailboxes — support@, info@, sales@.", costPerRow: 1, recordTypes: ["companies"], iconKey: "at-sign" },
  { kind: "ai_research", name: "AI Research", description: "AI summary — pain points & an outreach angle.", costPerRow: 2, recordTypes: ["people", "companies"], iconKey: "sparkles" },
];

export function columnSpec(kind: EnrichColumnKind): ColumnSpec {
  const spec = COLUMN_CATALOG.find((c) => c.kind === kind);
  if (!spec) throw new Error(`Unknown enrichment column: ${kind}`);
  return spec;
}

export function columnsForType(t: EnrichRecordType): ColumnSpec[] {
  return COLUMN_CATALOG.filter((c) => c.recordTypes.includes(t));
}

/** Sensible starting columns applied at import time. */
export const DEFAULT_COLUMNS: Record<EnrichRecordType, EnrichColumnKind[]> = {
  people: ["find_work_email", "verify_email", "enrich_company"],
  companies: ["enrich_company", "company_tech", "generic_emails"],
};

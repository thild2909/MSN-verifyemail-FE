import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Verification primitives                                             */
/* ------------------------------------------------------------------ */

export const VERIFICATION_STATUSES = [
  "valid",
  "invalid",
  "risky",
  "unknown",
  "disposable",
  "role",
  "catch_all",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** The four top-level buckets used for summaries / safe-to-send. */
export type VerificationBucket = "valid" | "invalid" | "risky" | "unknown";

export const checkResultSchema = z.enum(["pass", "fail", "unknown"]);
export type CheckResult = z.infer<typeof checkResultSchema>;

export const verificationChecksSchema = z.object({
  syntax: checkResultSchema,
  domain: checkResultSchema,
  dns: checkResultSchema,
  mx: checkResultSchema,
  smtp: checkResultSchema,
  mailbox: checkResultSchema,
  catchAll: z.boolean(),
  disposable: z.boolean(),
  roleBased: z.boolean(),
  freeProvider: z.boolean(),
  greylisted: z.boolean(),
});
export type VerificationChecks = z.infer<typeof verificationChecksSchema>;

export const verificationResultSchema = z.object({
  email: z.string(),
  status: z.enum(VERIFICATION_STATUSES),
  score: z.number().min(0).max(100),
  suggestedAction: z.string(),
  domain: z.string(),
  domainAgeYears: z.number().nullable(),
  checks: verificationChecksSchema,
  deepScanned: z.boolean().default(false),
  verifiedAt: z.string(), // ISO
  // Infrastructure details surfaced by the backend.
  provider: z.string().nullable().optional(), // ESP, e.g. "Google Workspace"
  mxRecords: z.array(z.string()).optional(), // MX server hostnames
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;

/* ------------------------------------------------------------------ */
/* Email records & lists                                              */
/* ------------------------------------------------------------------ */

export interface EmailRecord {
  id: string;
  listId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  /** Any additional columns preserved from the original upload. */
  custom?: Record<string, string>;
  result?: VerificationResult;
}

export type ListStatus = "draft" | "queued" | "processing" | "completed" | "failed";

export interface ListSummary {
  total: number;
  valid: number;
  invalid: number;
  risky: number;
  unknown: number;
  duplicates: number;
}

export interface EmailList {
  id: string;
  name: string;
  fileName: string;
  status: ListStatus;
  uploadedRows: number;
  uniqueEmails: number;
  progress: number; // 0-100
  emailColumn: string;
  columns: string[];
  summary: ListSummary;
  createdAt: string;
  completedAt?: string;
}

/** Safe-to-send = share of records that are valid (deliverable). */
export function safeToSendRate(summary: ListSummary): number {
  const scored = summary.valid + summary.invalid + summary.risky + summary.unknown;
  if (scored === 0) return 0;
  return Math.round((summary.valid / scored) * 100);
}

/* ------------------------------------------------------------------ */
/* Credits & billing                                                  */
/* ------------------------------------------------------------------ */

export interface CreditBalance {
  totalAllocation: number;
  totalRemaining: number;
  verificationAllocation: number;
  verificationRemaining: number;
  payAsYouGoAllocation: number;
  payAsYouGoRemaining: number;
}

export type CreditOperation =
  | "single_verification"
  | "bulk_verification"
  | "deep_scan"
  | "email_finder"
  | "api_verification"
  | "top_up";

export interface CreditTransaction {
  id: string;
  date: string;
  operation: CreditOperation;
  label: string;
  credits: number; // negative = spent, positive = added
  balance: number;
  user: string;
}

/* ------------------------------------------------------------------ */
/* Email Finder                                                       */
/* ------------------------------------------------------------------ */

export interface FinderResult {
  id: string;
  email: string;
  score: number; // 0-100 — deliverability score returned by the backend
  pattern: string;
  source: string;
  name?: string;
  jobTitle?: string;
  domain: string;
  status: VerificationStatus | "unverified";
  /** True for the single highest-confidence candidate in a result set. */
  bestGuess?: boolean;
  /** Finder verdict for this row (server pipeline results). */
  state?: FinderState;
}

export interface FinderSearch {
  id: string;
  type: "person" | "domain";
  query: string;
  createdAt: string;
  results: FinderResult[];
}

/** High-level verdict of a single-person finder search. */
export type FinderState =
  | "verified" // a deliverable mailbox was confirmed
  | "accept_all" // domain is catch-all; deliverability can't be confirmed
  | "no_mx" // domain can't receive mail at all
  | "not_found"; // no candidate pattern was deliverable

/** Result of the server-side finder pipeline: one best email + how we got it. */
export interface FinderOutcome {
  result: FinderResult;
  state: FinderState;
  smtpCalls: number; // backend verifications actually performed
  skipped: number; // candidate patterns we did NOT need to check
  provider: "reacher" | "mock";
  fromCache: boolean; // domain facts came from cache (0 or few live calls)
}

/** One person + their finder outcome, from the bulk finder. */
export interface BulkFinderResult {
  input: { firstName: string; lastName: string; domain: string };
  outcome: FinderOutcome;
}

/** Bulk finder response: per-person outcomes + resource-savings stats. */
export interface BulkFinderResponse {
  results: BulkFinderResult[];
  stats: {
    people: number;
    backendCalls: number; // real backend verifications performed
    naiveCalls: number; // cost of a per-candidate, no-cache approach
    saved: number; // calls avoided by early-exit + caches
  };
}

/* ------------------------------------------------------------------ */
/* Enrichment — Clay/Apollo-style enrichment tables                   */
/* ------------------------------------------------------------------ */
/*
 * An enrichment table is a spreadsheet: each ROW is a record the user imported
 * (a person or a company) and each COLUMN is an enrichment that runs per row
 * (a "waterfall" that tries providers in order until it finds a value). Each
 * CELL records status + the winning source + confidence + the providers tried,
 * exactly like Clay's per-cell enrichment provenance.
 */

export type EnrichStatus = "queued" | "enriching" | "completed" | "failed";
export type EnrichRecordType = "people" | "companies";

/** The enrichments a column can run. Availability depends on record type. */
export const ENRICH_COLUMN_KINDS = [
  "find_work_email", // people: email pattern/provider waterfall
  "verify_email", // people: verify an email (from a prior column or import)
  "find_phone", // people
  "find_linkedin", // people + companies
  "enrich_company", // people + companies: firmographics from the domain
  "company_tech", // people + companies: technographics
  "generic_emails", // companies: role mailboxes (support@, info@, sales@)
  "ai_research", // people + companies: AI summary/insight
] as const;
export type EnrichColumnKind = (typeof ENRICH_COLUMN_KINDS)[number];

export type EnrichCellStatus = "pending" | "running" | "found" | "not_found" | "error";

/** One provider attempt inside a cell's waterfall. */
export interface WaterfallStep {
  source: string; // e.g. "Pattern {first}.{last}", "SMTP verify", "MX cache"
  result: "hit" | "miss" | "skipped";
}

export interface EnrichCell {
  status: EnrichCellStatus;
  value: string | null; // primary displayed value
  detail: string | null; // secondary line (e.g. verification verdict, extra facts)
  source: string | null; // the winning provider
  confidence: number | null; // 0-100
  waterfall: WaterfallStep[]; // every provider tried, in order
  credits: number; // credits this cell consumed
}

export interface EnrichColumn {
  id: string;
  kind: EnrichColumnKind;
  name: string; // display header, e.g. "Work Email"
  costPerRow: number;
}

export interface EnrichRow {
  id: string;
  fields: Record<string, string>; // imported (canonical) data
  cells: Record<string, EnrichCell>; // columnId -> cell
}

export interface EnrichTableSummary {
  rows: number;
  cellsRun: number;
  cellsFound: number;
  emailsFound: number;
  creditsUsed: number;
}

export interface EnrichmentTable {
  id: string;
  name: string;
  fileName: string;
  recordType: EnrichRecordType;
  status: EnrichStatus;
  importedColumns: string[]; // canonical imported field names, in order
  identityColumns: string[]; // which imported cols form the record's identity
  columns: EnrichColumn[]; // enrichment columns, in order
  progress: number; // 0-100
  summary: EnrichTableSummary;
  createdAt: string;
  completedAt?: string;
}

/* ------------------------------------------------------------------ */
/* API keys & webhooks                                                */
/* ------------------------------------------------------------------ */

export interface ApiKey {
  id: string;
  name: string;
  maskedKey: string;
  createdAt: string;
  lastUsedAt?: string;
  status: "active" | "revoked";
  requests: number;
  creditsConsumed: number;
}

export const WEBHOOK_EVENTS = [
  "verification.completed",
  "verification.failed",
  "list.completed",
  "credits.low",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  status: "active" | "paused";
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  event: WebhookEvent;
  status: "success" | "failed" | "retrying";
  responseCode: number;
  attemptedAt: string;
}

/* ------------------------------------------------------------------ */
/* Integrations & team                                                */
/* ------------------------------------------------------------------ */

export interface Integration {
  id: string;
  provider: "mailchimp" | "hubspot" | "sparkpost" | "sendgrid" | "klaviyo";
  name: string;
  connected: boolean;
  lastSyncedAt?: string;
}

export type TeamRole = "Owner" | "Admin" | "Member" | "Viewer";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  status: "active" | "invited";
  joinedAt: string;
}

/* ------------------------------------------------------------------ */
/* Analytics                                                          */
/* ------------------------------------------------------------------ */

export interface AnalyticsPoint {
  date: string;
  valid: number;
  invalid: number;
  risky: number;
  unknown: number;
  credits: number;
}

export interface DomainStat {
  domain: string;
  total: number;
  validRate: number;
}

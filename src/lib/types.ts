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
  confidence: number; // 0-100
  pattern: string;
  source: string;
  name?: string;
  jobTitle?: string;
  domain: string;
  status: VerificationStatus | "unverified";
}

export interface FinderSearch {
  id: string;
  type: "person" | "domain";
  query: string;
  createdAt: string;
  results: FinderResult[];
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

import { seededRandom } from "../utils";
import { verifyEmailSync, statusBucket } from "./verification-engine";
import type {
  AnalyticsPoint,
  ApiKey,
  CreditBalance,
  CreditTransaction,
  DomainStat,
  EmailList,
  EmailRecord,
  FinderSearch,
  Integration,
  ListSummary,
  TeamMember,
  Webhook,
  WebhookDelivery,
} from "../types";

/* ------------------------------------------------------------------ */
/* Name / company pools for deterministic record generation           */
/* ------------------------------------------------------------------ */

const FIRST_NAMES = [
  "John", "Sarah", "David", "Emily", "Michael", "Jessica", "Daniel", "Laura",
  "James", "Anna", "Robert", "Sophie", "William", "Grace", "Thomas", "Olivia",
  "Chris", "Mia", "Kevin", "Nina", "Peter", "Chloe", "Mark", "Ruby",
];
const LAST_NAMES = [
  "Smith", "Lee", "Wong", "Brown", "Nguyen", "Patel", "Garcia", "Kim",
  "Johnson", "Miller", "Davis", "Wilson", "Taylor", "Anderson", "Chen", "Clark",
];
const COMPANIES = [
  { name: "Acme Corp", domain: "acme.com" },
  { name: "Globex", domain: "globex.io" },
  { name: "Initech", domain: "initech.com" },
  { name: "Umbrella", domain: "umbrella.co" },
  { name: "Hooli", domain: "hooli.com" },
  { name: "Stark Industries", domain: "stark.com" },
  { name: "Wayne Enterprises", domain: "wayne.com" },
  { name: "Cyberdyne", domain: "cyberdyne.ai" },
  { name: "Soylent", domain: "soylent.co" },
  { name: "Massive Dynamic", domain: "massivedynamic.com" },
];
const TITLES = [
  "CEO", "CTO", "COO", "VP Engineering", "Head of Growth", "Data Engineer",
  "Product Manager", "Marketing Lead", "Sales Director", "Recruiter",
  "Software Engineer", "Founder",
];

function pick<T>(arr: T[], seed: string): T {
  return arr[Math.floor(seededRandom(seed) * arr.length)];
}

/* ------------------------------------------------------------------ */
/* Records                                                            */
/* ------------------------------------------------------------------ */

/**
 * Deterministically generate up to `count` sample records for a list.
 * (A real backend paginates server-side; the mock generates a stable
 * representative sample and paginates it client-side.)
 */
export function generateRecordsForList(list: EmailList, count: number): EmailRecord[] {
  const records: EmailRecord[] = [];
  const n = Math.min(count, list.uniqueEmails);
  for (let i = 0; i < n; i++) {
    const seed = `${list.id}:${i}`;
    const first = pick(FIRST_NAMES, seed + "f");
    const last = pick(LAST_NAMES, seed + "l");
    const company = pick(COMPANIES, seed + "c");
    const roll = seededRandom(seed + "role");
    const local =
      roll > 0.9
        ? pick(["info", "sales", "support", "team"], seed + "rl")
        : `${first.toLowerCase()}.${last.toLowerCase()}`;
    const disposable = seededRandom(seed + "disp") > 0.96;
    const domain = disposable ? "mailinator.com" : company.domain;
    const email = `${local}@${domain}`;

    records.push({
      id: seed,
      listId: list.id,
      email,
      firstName: first,
      lastName: last,
      company: company.name,
      jobTitle: pick(TITLES, seed + "t"),
      result: verifyEmailSync(email, { deepScan: list.status === "completed" }),
    });
  }
  return records;
}

/** Compute a summary from a full (or representative) record set. */
export function summarize(records: EmailRecord[], duplicates: number): ListSummary {
  const s: ListSummary = {
    total: records.length,
    valid: 0,
    invalid: 0,
    risky: 0,
    unknown: 0,
    duplicates,
  };
  for (const r of records) {
    if (!r.result) continue;
    s[statusBucket(r.result.status)]++;
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Lists                                                              */
/* ------------------------------------------------------------------ */

function buildSummary(unique: number, validRate: number, progress: number): ListSummary {
  const scored = Math.round((unique * progress) / 100);
  const valid = Math.round(scored * validRate);
  const invalid = Math.round(scored * 0.16);
  const risky = Math.round(scored * 0.11);
  const unknown = Math.max(0, scored - valid - invalid - risky);
  return { total: unique, valid, invalid, risky, unknown, duplicates: Math.round(unique * 0.04) };
}

export const MOCK_LISTS: EmailList[] = [
  {
    id: "lst_apollo",
    name: "Apollo Contacts",
    fileName: "apollo-contacts.csv",
    status: "completed",
    uploadedRows: 2320,
    uniqueEmails: 2226,
    progress: 100,
    emailColumn: "email",
    columns: ["email", "first_name", "last_name", "company", "job_title"],
    summary: { total: 2226, valid: 1532, invalid: 401, risky: 173, unknown: 120, duplicates: 94 },
    createdAt: "2026-08-16T09:12:00Z",
    completedAt: "2026-08-16T09:41:00Z",
  },
  {
    id: "lst_au_ai",
    name: "Australia AI",
    fileName: "australia-ai.xlsx",
    status: "completed",
    uploadedRows: 2980,
    uniqueEmails: 2860,
    progress: 100,
    emailColumn: "email",
    columns: ["email", "first_name", "last_name", "company", "job_title", "city"],
    summary: buildSummary(2860, 0.67, 100),
    createdAt: "2026-08-14T14:02:00Z",
    completedAt: "2026-08-14T14:39:00Z",
  },
  {
    id: "lst_us_funding",
    name: "US Funding",
    fileName: "us-funding.csv",
    status: "processing",
    uploadedRows: 1240,
    uniqueEmails: 1200,
    progress: 72,
    emailColumn: "email",
    columns: ["email", "first_name", "last_name", "company"],
    summary: buildSummary(1200, 0.64, 72),
    createdAt: "2026-08-19T08:30:00Z",
  },
  {
    id: "lst_au_hiring",
    name: "australia-hiring-data-engineer",
    fileName: "australia-hiring-data-engineer.csv",
    status: "completed",
    uploadedRows: 1010,
    uniqueEmails: 990,
    progress: 100,
    emailColumn: "email",
    columns: ["email", "first_name", "last_name", "company", "job_title"],
    summary: buildSummary(990, 0.57, 100),
    createdAt: "2026-08-10T11:20:00Z",
    completedAt: "2026-08-10T11:38:00Z",
  },
];

/* ------------------------------------------------------------------ */
/* Credits                                                            */
/* ------------------------------------------------------------------ */

export const MOCK_CREDITS: CreditBalance = {
  totalAllocation: 60100,
  totalRemaining: 21763,
  verificationAllocation: 25000,
  verificationRemaining: 21150,
  payAsYouGoAllocation: 35100,
  payAsYouGoRemaining: 613,
};

export const MOCK_TRANSACTIONS: CreditTransaction[] = [
  { id: "tx_1", date: "2026-08-19T08:30:00Z", operation: "bulk_verification", label: "US Funding — bulk verify", credits: -864, balance: 21763, user: "labs@mindsupernova.com" },
  { id: "tx_2", date: "2026-08-18T16:05:00Z", operation: "top_up", label: "Pay-as-you-go top up", credits: 10000, balance: 22627, user: "labs@mindsupernova.com" },
  { id: "tx_3", date: "2026-08-16T09:12:00Z", operation: "bulk_verification", label: "Apollo Contacts — bulk verify", credits: -2226, balance: 12627, user: "labs@mindsupernova.com" },
  { id: "tx_4", date: "2026-08-16T08:44:00Z", operation: "deep_scan", label: "Apollo Contacts — deep scan (188)", credits: -376, balance: 14853, user: "labs@mindsupernova.com" },
  { id: "tx_5", date: "2026-08-15T13:20:00Z", operation: "email_finder", label: "Finder — acme.com", credits: -12, balance: 15229, user: "labs@mindsupernova.com" },
  { id: "tx_6", date: "2026-08-14T14:02:00Z", operation: "bulk_verification", label: "Australia AI — bulk verify", credits: -2860, balance: 15241, user: "labs@mindsupernova.com" },
  { id: "tx_7", date: "2026-08-13T10:11:00Z", operation: "api_verification", label: "API — /verify (batch)", credits: -540, balance: 18101, user: "api" },
  { id: "tx_8", date: "2026-08-10T11:20:00Z", operation: "bulk_verification", label: "australia-hiring-data-engineer", credits: -990, balance: 18641, user: "labs@mindsupernova.com" },
];

/* ------------------------------------------------------------------ */
/* API keys / webhooks                                                */
/* ------------------------------------------------------------------ */

export const MOCK_API_KEYS: ApiKey[] = [
  { id: "key_1", name: "Production", maskedKey: "sk_live_••••••••••••4f2a", createdAt: "2026-06-01T10:00:00Z", lastUsedAt: "2026-08-19T07:55:00Z", status: "active", requests: 48210, creditsConsumed: 48210 },
  { id: "key_2", name: "Staging", maskedKey: "sk_test_••••••••••••9b71", createdAt: "2026-07-12T10:00:00Z", lastUsedAt: "2026-08-18T22:10:00Z", status: "active", requests: 3122, creditsConsumed: 3122 },
  { id: "key_3", name: "Legacy import", maskedKey: "sk_live_••••••••••••1c08", createdAt: "2026-03-04T10:00:00Z", status: "revoked", requests: 12980, creditsConsumed: 12980 },
];

export const MOCK_WEBHOOKS: Webhook[] = [
  { id: "wh_1", url: "https://app.mindsupernova.com/webhooks/email-verification", events: ["verification.completed", "list.completed", "credits.low"], status: "active", createdAt: "2026-07-01T10:00:00Z" },
];

export const MOCK_WEBHOOK_DELIVERIES: WebhookDelivery[] = [
  { id: "whd_1", event: "list.completed", status: "success", responseCode: 200, attemptedAt: "2026-08-16T09:41:00Z" },
  { id: "whd_2", event: "verification.completed", status: "success", responseCode: 200, attemptedAt: "2026-08-16T09:41:02Z" },
  { id: "whd_3", event: "credits.low", status: "retrying", responseCode: 503, attemptedAt: "2026-08-19T08:31:00Z" },
  { id: "whd_4", event: "verification.failed", status: "failed", responseCode: 500, attemptedAt: "2026-08-18T12:03:00Z" },
];

/* ------------------------------------------------------------------ */
/* Integrations / team                                                */
/* ------------------------------------------------------------------ */

export const MOCK_INTEGRATIONS: Integration[] = [
  { id: "int_mc", provider: "mailchimp", name: "Mailchimp", connected: true, lastSyncedAt: "2026-08-18T09:00:00Z" },
  { id: "int_hs", provider: "hubspot", name: "HubSpot", connected: false },
  { id: "int_sp", provider: "sparkpost", name: "SparkPost", connected: false },
  { id: "int_sg", provider: "sendgrid", name: "SendGrid", connected: false },
  { id: "int_kl", provider: "klaviyo", name: "Klaviyo", connected: false },
];

export const MOCK_TEAM: TeamMember[] = [
  { id: "u_1", name: "MindSupernova Labs", email: "labs@mindsupernova.com", role: "Owner", status: "active", joinedAt: "2026-01-05T10:00:00Z" },
  { id: "u_2", name: "Priya Raman", email: "priya@mindsupernova.com", role: "Admin", status: "active", joinedAt: "2026-02-11T10:00:00Z" },
  { id: "u_3", name: "Tom Becker", email: "tom@mindsupernova.com", role: "Member", status: "active", joinedAt: "2026-03-20T10:00:00Z" },
  { id: "u_4", name: "Dana Cole", email: "dana@contractor.io", role: "Viewer", status: "invited", joinedAt: "2026-08-17T10:00:00Z" },
];

/* ------------------------------------------------------------------ */
/* Analytics                                                          */
/* ------------------------------------------------------------------ */

export function buildAnalytics(days: number): AnalyticsPoint[] {
  const out: AnalyticsPoint[] = [];
  const end = new Date("2026-08-19T00:00:00Z").getTime();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(end - i * 86400000);
    const seed = `an:${date.toISOString().slice(0, 10)}`;
    const base = 400 + Math.floor(seededRandom(seed) * 900);
    const valid = Math.floor(base * (0.6 + seededRandom(seed + "v") * 0.12));
    const invalid = Math.floor(base * (0.14 + seededRandom(seed + "i") * 0.06));
    const risky = Math.floor(base * (0.09 + seededRandom(seed + "r") * 0.05));
    const unknown = Math.max(0, base - valid - invalid - risky);
    out.push({
      date: date.toISOString().slice(0, 10),
      valid,
      invalid,
      risky,
      unknown,
      credits: base,
    });
  }
  return out;
}

export const MOCK_DOMAIN_STATS: DomainStat[] = [
  { domain: "gmail.com", total: 8420, validRate: 82 },
  { domain: "acme.com", total: 2210, validRate: 74 },
  { domain: "outlook.com", total: 1980, validRate: 79 },
  { domain: "globex.io", total: 1240, validRate: 68 },
  { domain: "hooli.com", total: 980, validRate: 71 },
  { domain: "yahoo.com", total: 760, validRate: 63 },
];

/* ------------------------------------------------------------------ */
/* Finder                                                             */
/* ------------------------------------------------------------------ */

export const MOCK_FINDER_SEARCHES: FinderSearch[] = [
  {
    id: "fs_acme",
    type: "domain",
    query: "acme.com",
    createdAt: "2026-08-15T13:20:00Z",
    results: [
      { id: "fr_1", email: "john.smith@acme.com", confidence: 96, pattern: "{first}.{last}", source: "web + pattern match", name: "John Smith", jobTitle: "CEO", domain: "acme.com", status: "valid" },
      { id: "fr_2", email: "sarah.lee@acme.com", confidence: 94, pattern: "{first}.{last}", source: "web + pattern match", name: "Sarah Lee", jobTitle: "CTO", domain: "acme.com", status: "valid" },
      { id: "fr_3", email: "david.wong@acme.com", confidence: 91, pattern: "{first}.{last}", source: "web + pattern match", name: "David Wong", jobTitle: "COO", domain: "acme.com", status: "risky" },
      { id: "fr_4", email: "emily.brown@acme.com", confidence: 88, pattern: "{first}.{last}", source: "pattern match", name: "Emily Brown", jobTitle: "VP Engineering", domain: "acme.com", status: "unverified" },
    ],
  },
];

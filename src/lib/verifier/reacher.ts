/**
 * Mapping layer for the `check-if-email-exists` / Supernova backend.
 *
 * The Rust service (POST /v1/check_email) returns a `CheckEmailOutput`.
 * Here we translate that into the app's own `VerificationResult` so the
 * rest of the UI stays backend-agnostic.
 */
import type {
  CheckResult,
  VerificationChecks,
  VerificationResult,
  VerificationStatus,
} from "@/lib/types";

/* ------------------------- Backend response shape ------------------------ */

export type Reachable = "safe" | "risky" | "invalid" | "unknown";

interface SyntaxDetails {
  address?: string | null;
  domain: string;
  is_valid_syntax: boolean;
  username: string;
  normalized_email?: string | null;
  suggestion?: string | null;
}
interface MxDetails {
  accepts_mail: boolean;
  records: string[];
}
interface SmtpDetails {
  can_connect_smtp: boolean;
  has_full_inbox: boolean;
  is_catch_all: boolean;
  is_deliverable: boolean;
  is_disabled: boolean;
}
interface MiscDetails {
  is_disposable: boolean;
  is_role_account: boolean;
  is_b2c?: boolean;
  gravatar_url?: string | null;
}
interface DomainDetails {
  spf?: { found: boolean; policy: string } | null;
  dmarc?: { found: boolean; policy: string } | null;
  provider?: string | null;
  is_parked?: boolean;
  mx_count?: number;
}

export interface CheckEmailOutput {
  input: string;
  is_reachable: Reachable;
  /** Authoritative 0-100 score computed by newer backends. */
  score?: number;
  // Each of these can also serialize as an error object { type, message }.
  misc: MiscDetails | Record<string, unknown>;
  mx: MxDetails | Record<string, unknown>;
  smtp: SmtpDetails | Record<string, unknown>;
  syntax: SyntaxDetails;
  domain?: DomainDetails | Record<string, unknown>;
  debug?: { start_time?: string; end_time?: string };
}

/* ----------------------------- Type guards ------------------------------- */

function isMx(v: unknown): v is MxDetails {
  return !!v && typeof (v as MxDetails).accepts_mail === "boolean";
}
function isSmtp(v: unknown): v is SmtpDetails {
  return !!v && typeof (v as SmtpDetails).is_deliverable === "boolean";
}
function isMisc(v: unknown): v is MiscDetails {
  return !!v && typeof (v as MiscDetails).is_disposable === "boolean";
}
function isDomain(v: unknown): v is DomainDetails {
  return !!v && typeof v === "object";
}

/** Human-friendly ESP label from the backend's provider slug. */
const PROVIDER_LABELS: Record<string, string> = {
  google_workspace: "Google Workspace",
  gmail: "Gmail",
  microsoft365: "Microsoft 365",
  outlook: "Outlook / Hotmail",
  yahoo: "Yahoo",
  zoho: "Zoho Mail",
  proton: "Proton Mail",
  icloud: "iCloud Mail",
  amazon_ses: "Amazon SES",
  mimecast: "Mimecast",
  proofpoint: "Proofpoint",
};
function formatProvider(p?: string | null): string | null {
  if (!p) return null;
  return PROVIDER_LABELS[p] ?? p.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Strip the trailing dot from FQDN MX records: "SMTP.GOOGLE.com." → "smtp.google.com". */
function cleanMxRecords(records?: string[]): string[] {
  return (records ?? []).map((r) => r.replace(/\.$/, "").toLowerCase()).filter(Boolean);
}

const FREE_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "yandex.com",
]);

/* ------------------------------- Mapping --------------------------------- */

export function mapReacherOutput(o: CheckEmailOutput): VerificationResult {
  const syntax = o.syntax;
  const mx = isMx(o.mx) ? o.mx : null;
  const smtp = isSmtp(o.smtp) ? o.smtp : null;
  const misc = isMisc(o.misc) ? o.misc : null;
  const dom = isDomain(o.domain) ? (o.domain as DomainDetails) : null;

  const mxRecords = cleanMxRecords(mx?.records);
  const provider = formatProvider(dom?.provider);

  const domain = syntax?.domain ?? o.input.split("@")[1] ?? "";
  const validSyntax = syntax?.is_valid_syntax ?? false;
  const mxOk = mx?.accepts_mail ?? false;
  const catchAll = smtp?.is_catch_all ?? false;
  const disposable = misc?.is_disposable ?? false;
  const roleBased = misc?.is_role_account ?? false;

  // --- individual checks ---
  const smtpCheck: CheckResult = !smtp || !smtp.can_connect_smtp
    ? "unknown"
    : smtp.is_deliverable
      ? "pass"
      : catchAll
        ? "unknown"
        : "fail";

  const mailboxCheck: CheckResult = !smtp
    ? "unknown"
    : smtp.is_deliverable
      ? "pass"
      : smtp.can_connect_smtp && !catchAll
        ? "fail"
        : "unknown";

  const checks: VerificationChecks = {
    syntax: validSyntax ? "pass" : "fail",
    domain: mxOk || (mx?.records.length ?? 0) > 0 ? "pass" : validSyntax ? "unknown" : "fail",
    dns: (mx?.records.length ?? 0) > 0 ? "pass" : "unknown",
    mx: mxOk ? "pass" : "fail",
    smtp: smtpCheck,
    mailbox: mailboxCheck,
    catchAll,
    disposable,
    roleBased,
    freeProvider: FREE_DOMAINS.has(domain.toLowerCase()),
    greylisted: false,
  };

  const cls = classify(o.is_reachable, checks, smtp);

  // The backend's own score is authoritative. Only fall back to the
  // locally-derived score for older backends that don't send one.
  const score =
    typeof o.score === "number" && Number.isFinite(o.score)
      ? Math.max(0, Math.min(100, Math.round(o.score)))
      : cls.score;

  return {
    email: syntax?.normalized_email || o.input,
    status: cls.status,
    score,
    suggestedAction: cls.suggestedAction,
    domain,
    domainAgeYears: null, // not provided by the backend
    checks,
    deepScanned: true, // the backend always performs a full SMTP check
    verifiedAt: o.debug?.end_time || new Date().toISOString(),
    provider,
    mxRecords,
  };
}

function classify(
  reachable: Reachable,
  c: VerificationChecks,
  smtp: SmtpDetails | null,
): { status: VerificationStatus; score: number; suggestedAction: string } {
  if (c.syntax === "fail") {
    return { status: "invalid", score: 3, suggestedAction: "Remove — invalid email syntax." };
  }
  if (reachable === "invalid" || c.mx === "fail" || (smtp?.is_disabled ?? false)) {
    return { status: "invalid", score: 7, suggestedAction: "Remove — this address is undeliverable." };
  }
  if (c.disposable) {
    return { status: "disposable", score: 18, suggestedAction: "Do not send — temporary/disposable inbox." };
  }
  if (reachable === "safe") {
    if (c.roleBased) {
      return { status: "role", score: 74, suggestedAction: "Deliverable, but a shared role inbox — expect low engagement." };
    }
    return { status: "valid", score: c.freeProvider ? 92 : 96, suggestedAction: "Safe to send — mailbox verified deliverable." };
  }
  if (c.catchAll) {
    return { status: "catch_all", score: 54, suggestedAction: "Risky — domain accepts all mail; deliverability unconfirmed." };
  }
  if (c.roleBased) {
    return { status: "role", score: 60, suggestedAction: "Use with caution — shared role inbox." };
  }
  if (reachable === "risky") {
    return { status: "risky", score: 62, suggestedAction: "Risky — verification was inconclusive; send carefully." };
  }
  return { status: "unknown", score: 40, suggestedAction: "Unknown — the mail server did not give a definitive answer." };
}

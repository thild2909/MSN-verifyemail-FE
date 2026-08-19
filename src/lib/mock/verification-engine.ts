import { seededRandom } from "../utils";
import type {
  CheckResult,
  VerificationChecks,
  VerificationResult,
  VerificationStatus,
} from "../types";

/**
 * A modular, deterministic mock verification engine.
 *
 * It mirrors the real pipeline shape described in the spec
 * (syntax -> domain -> DNS -> MX -> disposable/role -> SMTP ->
 * catch-all -> risk scoring -> classification) and implements a
 * `VerificationProvider` so a real DNS/SMTP provider can be dropped
 * in later without touching the rest of the app.
 */
export interface VerificationProvider {
  verify(email: string, opts?: { deepScan?: boolean }): Promise<VerificationResult>;
}

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "10minutemail.com",
  "guerrillamail.com",
  "tempmail.com",
  "throwaway.email",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
]);

const FREE_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "gmx.com",
]);

const ROLE_LOCALPARTS = new Set([
  "info",
  "support",
  "admin",
  "sales",
  "contact",
  "hello",
  "team",
  "billing",
  "help",
  "office",
  "no-reply",
  "noreply",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function b(v: boolean): CheckResult {
  return v ? "pass" : "fail";
}

/** Synchronous core so bulk verification can reuse it without promises. */
export function verifyEmailSync(
  email: string,
  opts: { deepScan?: boolean } = {},
): VerificationResult {
  const normalized = email.trim().toLowerCase();
  const [localPart = "", domain = ""] = normalized.split("@");
  const rand = seededRandom(normalized);

  const syntaxOk = EMAIL_RE.test(normalized);
  const isDisposable = DISPOSABLE_DOMAINS.has(domain);
  const isFree = FREE_DOMAINS.has(domain);
  const isRole = ROLE_LOCALPARTS.has(localPart);

  // Domain / DNS / MX — mostly resolve unless syntax is broken or the
  // domain "looks" dead (seeded).
  const domainOk = syntaxOk && rand > 0.05;
  const dnsOk = domainOk;
  const mxOk = domainOk && rand > 0.08;

  // SMTP / mailbox — the uncertain part. Deep scan resolves more.
  let smtp: CheckResult = "unknown";
  let mailbox: CheckResult = "unknown";
  let catchAll = false;

  if (mxOk) {
    if (opts.deepScan) {
      const r2 = seededRandom(normalized + ":deep");
      catchAll = r2 > 0.82;
      smtp = r2 > 0.18 ? "pass" : "fail";
      mailbox = smtp === "pass" && !catchAll ? "pass" : catchAll ? "unknown" : "fail";
    } else {
      // Without deep scan, SMTP is frequently inconclusive.
      smtp = rand > 0.6 ? "pass" : rand > 0.3 ? "unknown" : "fail";
      catchAll = rand > 0.9;
      mailbox = "unknown";
    }
  }

  const greylisted = mxOk && seededRandom(normalized + ":grey") > 0.9;

  const checks: VerificationChecks = {
    syntax: b(syntaxOk),
    domain: b(domainOk),
    dns: b(dnsOk),
    mx: b(mxOk),
    smtp,
    mailbox,
    catchAll,
    disposable: isDisposable,
    roleBased: isRole,
    freeProvider: isFree,
    greylisted,
  };

  const { status, score, suggestedAction } = classify(checks);

  return {
    email: normalized,
    status,
    score,
    suggestedAction,
    domain,
    domainAgeYears: domainOk ? Math.round(1 + rand * 18) : null,
    checks,
    deepScanned: Boolean(opts.deepScan),
    verifiedAt: new Date().toISOString(),
  };
}

/** Combine multiple signals into a final classification + score (0-100). */
function classify(c: VerificationChecks): {
  status: VerificationStatus;
  score: number;
  suggestedAction: string;
} {
  if (c.syntax === "fail" || c.domain === "fail" || c.mx === "fail") {
    return {
      status: "invalid",
      score: 4,
      suggestedAction: "Remove — this address is undeliverable.",
    };
  }
  if (c.disposable) {
    return {
      status: "disposable",
      score: 18,
      suggestedAction: "Do not send — temporary/disposable inbox.",
    };
  }
  if (c.smtp === "fail" || c.mailbox === "fail") {
    return {
      status: "invalid",
      score: 9,
      suggestedAction: "Remove — the mailbox rejected verification.",
    };
  }
  if (c.roleBased) {
    return {
      status: "role",
      score: 55,
      suggestedAction: "Use with caution — shared role inbox, low engagement.",
    };
  }
  if (c.catchAll) {
    return {
      status: "catch_all",
      score: 52,
      suggestedAction: "Risky — domain accepts all mail; deliverability unconfirmed.",
    };
  }
  if (c.smtp === "unknown" || c.mailbox === "unknown" || c.greylisted) {
    return {
      status: "risky",
      score: 64,
      suggestedAction: "Risky — verification was inconclusive; send carefully.",
    };
  }
  if (c.smtp === "pass" && c.mailbox === "pass") {
    return {
      status: "valid",
      score: 92 + Math.round((c.freeProvider ? 0 : 4)),
      suggestedAction: "Safe to send — mailbox verified deliverable.",
    };
  }
  return {
    status: "unknown",
    score: 40,
    suggestedAction: "Unknown — could not reach a confident conclusion.",
  };
}

/** Async provider wrapper with a small simulated latency. */
export const mockProvider: VerificationProvider = {
  async verify(email, opts) {
    await new Promise((r) => setTimeout(r, 650 + Math.random() * 700));
    return verifyEmailSync(email, opts);
  },
};

/** Map any status to its top-level summary bucket. */
export function statusBucket(
  status: VerificationStatus,
): "valid" | "invalid" | "risky" | "unknown" {
  switch (status) {
    case "valid":
      return "valid";
    case "invalid":
      return "invalid";
    case "risky":
    case "catch_all":
    case "role":
    case "disposable":
      return "risky";
    default:
      return "unknown";
  }
}

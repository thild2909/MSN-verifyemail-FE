/**
 * Server-only client for the `check-if-email-exists` backend.
 * Runs inside Next.js route handlers — never imported by client code,
 * so the backend URL and optional shared secret stay on the server.
 *
 * There is exactly ONE source of truth for deliverability: the Rust engine.
 * This module NEVER fabricates, guesses, or mocks a positive verdict. If the
 * engine gives an answer (valid / invalid / catch_all / risky / unknown /
 * disabled), that answer is returned verbatim — an engine "unknown" is a real
 * verdict, not a failure.
 *
 * Two failure kinds are kept distinct:
 *   - A GENUINE outage — connection refused, DNS failure, non-2xx — means the
 *     engine can't answer at all. This throws `VerifierUnavailableError` so the
 *     caller surfaces a real error and never marks addresses "not found".
 *   - A per-request TIMEOUT (our own deadline firing) means the engine is up but
 *     this ONE mailbox's SMTP probe was too slow. That is a transient, per-email
 *     condition, NOT a global outage, so it returns an honest `unknown` for that
 *     address (never cached, safe to retry) and the caller carries on. This is
 *     what keeps a bulk pass from aborting wholesale on a single slow mailbox.
 * It must never return a made-up "valid".
 */
import "server-only";
import { mapReacherOutput, type CheckEmailOutput } from "./reacher";
import type { VerificationResult } from "@/lib/types";

export const BACKEND_URL = process.env.EMAIL_VERIFIER_URL ?? "http://localhost:8080";
const SECRET = process.env.EMAIL_VERIFIER_SECRET;
// Per-request deadline. Lowered from 60s → 25s: a responsive mail server answers
// a verification (DNS + SMTP RCPT) in a few seconds; a server that has not replied
// in 25s is tarpitting / unreachable and will not yield a trustworthy verdict no
// matter how long we wait — waiting the old 60s just froze the People pass (each
// "hard" row runs ~20-30 SMTP checks; at 60s a single tarpitting domain cost
// minutes). A deadline hit returns a transient `unknown` (never cached, mx left
// "unknown" so the finder does NOT treat it as a dead domain), so recall on
// genuinely-slow-but-real mailboxes is only ever deferred, never wrongly failed.
// Tune with EMAIL_VERIFIER_TIMEOUT_MS.
const TIMEOUT_MS = Number(process.env.EMAIL_VERIFIER_TIMEOUT_MS ?? 25_000);

/** Raised when the verification engine cannot be reached or refuses the request. */
export class VerifierUnavailableError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "VerifierUnavailableError";
    this.status = status;
  }
}

export interface VerifyOutcome {
  result: VerificationResult;
  provider: "reacher";
  /** True when OUR per-request deadline fired (the server did not answer in time),
   *  as opposed to the engine returning a verdict. Lets the finder treat a domain
   *  whose probe timed out as unverifiable (tarpit/unreachable) and skip a futile
   *  full sweep — without confusing it with a fast engine `unknown` (greylist). */
  timedOut?: boolean;
}

/**
 * An honest "we couldn't determine this in time" verdict for one address, used
 * when our per-request deadline fires (a slow mailbox) rather than the engine
 * being down. `mx` is deliberately "unknown" (never "fail") so the finder does
 * NOT mistake a slow probe for a dead domain, and the status is never cached.
 */
function timedOutOutcome(email: string): VerifyOutcome {
  const domain = email.split("@")[1] ?? "";
  return {
    provider: "reacher",
    timedOut: true,
    result: {
      email,
      status: "unknown",
      score: 0,
      suggestedAction: "Unknown: the mail server did not answer in time. Retry later.",
      domain,
      domainAgeYears: null,
      checks: {
        syntax: "unknown", domain: "unknown", dns: "unknown", mx: "unknown",
        smtp: "unknown", mailbox: "unknown",
        catchAll: false, disposable: false, roleBased: false, freeProvider: false, greylisted: false,
      },
      deepScanned: false,
      verifiedAt: new Date().toISOString(),
      provider: null,
      mxRecords: [],
    },
  };
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (SECRET) h["x-supernova-secret"] = SECRET;
  return h;
}

/**
 * Verify one email through the Rust engine. Returns the engine's verdict, or
 * throws `VerifierUnavailableError` if the engine could not be reached. Never
 * returns a fabricated result.
 */
// The engine demonstrably serves /v1/check_email (verified: 30 concurrent → 30×200),
// so ANY non-2xx it returns under load — a stray 404, a 429/5xx, a dropped
// connection — is transient, not a permanent "route missing". Retry them all EXCEPT
// auth failures (401/403), where a config secret is wrong and a retry can't help.
// This is what stops a single stray 404 mid-pass from aborting the whole run
// ("Verification interrupted"). A brief jittered backoff clears the blip.
const NON_RETRYABLE_STATUS = new Set([401, 403]);
const MAX_ATTEMPTS = Math.max(1, Math.min(Number(process.env.VERIFY_MAX_ATTEMPTS ?? 4), 8));

/** One backend attempt. Returns the outcome, OR throws `{ retryable, status }`. */
async function verifyAttempt(email: string, timeoutMs: number): Promise<VerifyOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BACKEND_URL}/v1/check_email`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ to_email: email }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const e = new VerifierUnavailableError(`Verification engine responded ${res.status}: ${body.slice(0, 200)}`, res.status);
      (e as { retryable?: boolean }).retryable = !NON_RETRYABLE_STATUS.has(res.status);
      throw e;
    }
    const output = (await res.json()) as CheckEmailOutput;
    return { result: mapReacherOutput(output), provider: "reacher" };
  } catch (err) {
    if (err instanceof VerifierUnavailableError) throw err;
    // Our own deadline fired → engine is up but this mailbox was slow. Transient
    // per-email "unknown" so the pass keeps going (no retry, no abort).
    if (controller.signal.aborted) return timedOutOutcome(email);
    // A network/connection error (ECONNREFUSED / reset / socket hang up) — common
    // when the engine is briefly overloaded; retryable.
    const message = err instanceof Error ? err.message : "Unknown error";
    const e = new VerifierUnavailableError(`Verification engine unreachable: ${message}`);
    (e as { retryable?: boolean }).retryable = true;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyWithBackend(email: string, opts: { timeoutMs?: number } = {}): Promise<VerifyOutcome> {
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : TIMEOUT_MS;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await verifyAttempt(email, timeoutMs);
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof VerifierUnavailableError && (err as { retryable?: boolean }).retryable === true;
      if (!retryable || attempt === MAX_ATTEMPTS) throw err;
      // Backoff with jitter so many concurrent workers don't retry in lockstep.
      await new Promise((r) => setTimeout(r, 250 * attempt + Math.floor(Math.random() * 200)));
    }
  }
  throw lastErr; // unreachable
}

/**
 * Verify many emails in ONE request via `/v1/check_email_batch`. Returns one
 * outcome per input email, in order. Throws `VerifierUnavailableError` if the
 * engine could not be reached. Never fabricates results for missing entries —
 * a missing entry is re-verified through the single endpoint (which itself
 * throws if the engine is down).
 */
export async function verifyEmailsBatch(
  emails: string[],
  opts: { timeoutMs?: number; concurrency?: number } = {},
): Promise<VerifyOutcome[]> {
  if (emails.length === 0) return [];
  const timeoutMs = opts.timeoutMs ?? Math.min(TIMEOUT_MS, 30_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BACKEND_URL}/v1/check_email_batch`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ to_emails: emails, concurrency: opts.concurrency ?? 5 }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new VerifierUnavailableError(
        `Verification engine responded ${res.status}: ${body.slice(0, 200)}`,
        res.status,
      );
    }
    const json = (await res.json()) as { results: CheckEmailOutput[] };
    const results = json.results ?? [];
    return Promise.all(
      emails.map(async (email, i) => {
        const out = results[i];
        if (out) return { result: mapReacherOutput(out), provider: "reacher" as const };
        // Missing entry: re-verify individually (throws if the engine is down).
        return verifyWithBackend(email);
      }),
    );
  } catch (err) {
    if (err instanceof VerifierUnavailableError) throw err;
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new VerifierUnavailableError(`Verification engine unreachable: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Lightweight reachability probe for the backend, used by /api/health. */
export async function pingBackend(): Promise<{ online: boolean; url: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    // A malformed body still proves the HTTP server is up and responding.
    const res = await fetch(`${BACKEND_URL}/v1/check_email`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ to_email: "ping@example.com" }),
      signal: controller.signal,
      cache: "no-store",
    });
    return { online: res.ok, url: BACKEND_URL };
  } catch (err) {
    return { online: false, url: BACKEND_URL, error: err instanceof Error ? err.message : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

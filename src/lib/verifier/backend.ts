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
const TIMEOUT_MS = Number(process.env.EMAIL_VERIFIER_TIMEOUT_MS ?? 60_000);

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
export async function verifyWithBackend(email: string): Promise<VerifyOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
      throw new VerifierUnavailableError(
        `Verification engine responded ${res.status}: ${body.slice(0, 200)}`,
        res.status,
      );
    }
    const output = (await res.json()) as CheckEmailOutput;
    return { result: mapReacherOutput(output), provider: "reacher" };
  } catch (err) {
    if (err instanceof VerifierUnavailableError) throw err;
    // Our own deadline fired (controller aborted) → the engine is up but this
    // one mailbox was too slow. Treat as a transient per-email "unknown" so a
    // bulk pass keeps going instead of aborting on a single slow SMTP probe.
    if (controller.signal.aborted) return timedOutOutcome(email);
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new VerifierUnavailableError(`Verification engine unreachable: ${message}`);
  } finally {
    clearTimeout(timer);
  }
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

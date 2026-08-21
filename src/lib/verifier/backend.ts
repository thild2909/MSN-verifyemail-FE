/**
 * Server-only client for the `check-if-email-exists` backend.
 * Runs inside Next.js route handlers — never imported by client code,
 * so the backend URL and optional shared secret stay on the server.
 */
import "server-only";
import { mapReacherOutput, type CheckEmailOutput } from "./reacher";
import { verifyEmailSync } from "@/lib/mock/verification-engine";
import type { VerificationResult } from "@/lib/types";

export const BACKEND_URL = process.env.EMAIL_VERIFIER_URL ?? "http://localhost:8080";
const SECRET = process.env.EMAIL_VERIFIER_SECRET;
const TIMEOUT_MS = Number(process.env.EMAIL_VERIFIER_TIMEOUT_MS ?? 60_000);

export interface VerifyOutcome {
  result: VerificationResult;
  provider: "reacher" | "mock";
  error?: string;
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (SECRET) h["x-supernova-secret"] = SECRET;
  return h;
}

/**
 * Verify one email through the backend. On any failure (backend down,
 * timeout, non-2xx) it falls back to the local heuristic engine so the
 * product stays usable — the response flags which provider answered.
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
      throw new Error(`Backend responded ${res.status}: ${body.slice(0, 200)}`);
    }
    const output = (await res.json()) as CheckEmailOutput;
    return { result: mapReacherOutput(output), provider: "reacher" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      result: verifyEmailSync(email, { deepScan: true }),
      provider: "mock",
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify many emails in ONE request via the backend's `/v1/check_email_batch`
 * endpoint (inline, concurrent). Order is preserved. On any batch-level failure
 * (backend down, timeout, non-2xx) it falls back to the local mock engine for
 * every email so the flow never blocks — `provider` flags which answered.
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
      throw new Error(`Backend responded ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { results: CheckEmailOutput[] };
    const results = json.results ?? [];
    return emails.map((email, i) => {
      const out = results[i];
      return out
        ? { result: mapReacherOutput(out), provider: "reacher" as const }
        : { result: verifyEmailSync(email, { deepScan: true }), provider: "mock" as const, error: "missing result" };
    });
  } catch {
    // The batch endpoint may be unavailable (older backend without it). Fall
    // back to the single `/v1/check_email` endpoint per email — still the REAL
    // backend — which itself degrades to the mock engine if unreachable.
    return Promise.all(emails.map((email) => verifyWithBackend(email)));
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

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

/**
 * Server-only client for the /verification backend, now owned by BE-service
 * (crawler-service). Lists, records, verification results and credits live in
 * BE-service's PostgreSQL; these route handlers proxy to it. Kept on the server
 * so the service URL never reaches the browser.
 */
import "server-only";
import { beAuthHeaders } from "@/server/session";

const BASE = process.env.VERIFY_SERVICE_URL ?? process.env.CRAWLER_SERVICE_URL ?? "http://localhost:8090";
const TIMEOUT_MS = Number(process.env.VERIFY_SERVICE_TIMEOUT_MS ?? 120_000);

export interface BeResponse<T = unknown> {
  ok: boolean;
  status: number;
  json: T;
}

/** Call BE-service and return the parsed JSON + status (never throws on non-2xx). */
export async function be<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<BeResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Only declare a JSON content-type when there is actually a body. A bodyless
    // request (GET / DELETE) that still sends "Content-Type: application/json"
    // makes Fastify reject it with FST_ERR_CTP_EMPTY_JSON_BODY (400).
    // Credentials (user session + service token) are always attached — BE-service
    // rejects any un-authenticated call. Caller-supplied headers win.
    const headers = {
      ...(await beAuthHeaders()),
      ...(init.body != null ? { "Content-Type": "application/json" } : {}),
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (e) {
      // BE-service down / unreachable / timed out. Report it as a 503 instead of
      // throwing, so route handlers answer with JSON (an uncaught throw becomes
      // an empty 500 body → "Unexpected end of JSON input" in the browser).
      console.error(`[be] ${init.method ?? "GET"} ${BASE}${path} failed:`, (e as Error)?.message ?? e);
      return {
        ok: false,
        status: 503,
        json: { error: { code: "BE_UNAVAILABLE", message: "Backend service is unavailable." } } as T,
      };
    }
    const json = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/** Raw fetch (non-JSON responses, e.g. export bodies). */
export function beUrl(path: string): string {
  return `${BASE}${path}`;
}

/**
 * Map a failed BE response to the FE envelope, preserving client-error codes
 * (400 validation, 401/403 auth, 404 missing, 429 throttled) instead of turning
 * every failure into a 502. BE error text is never echoed; only `fallback` is
 * used for real upstream failures.
 */
export function beError(res: BeResponse, fallback: string): Response {
  const map: Record<number, [string, string]> = {
    400: ["INVALID_REQUEST", "Invalid request."],
    401: ["UNAUTHENTICATED", "Not authenticated."],
    403: ["FORBIDDEN", "Not allowed."],
    404: ["NOT_FOUND", "Not found."],
    413: ["TOO_LARGE", "Request too large."],
    429: ["RATE_LIMITED", "Too many requests. Try again later."],
  };
  const hit = map[res.status];
  const [code, message, status] = hit ? [hit[0], hit[1], res.status] : ["INTERNAL", fallback, 502];
  return Response.json({ success: false, error: { code, message } }, { status });
}

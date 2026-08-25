/**
 * Server-only client for the /verification backend, now owned by BE-service
 * (crawler-service). Lists, records, verification results and credits live in
 * BE-service's PostgreSQL; these route handlers proxy to it. Kept on the server
 * so the service URL never reaches the browser.
 */
import "server-only";

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
    const headers = {
      ...(init.body != null ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    };
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
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

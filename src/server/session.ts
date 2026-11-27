/**
 * Server-only: credentials for FE → BE-service calls.
 *
 * BE-service denies every route by default (BE src/auth/guard.ts). Each call
 * from this server carries:
 *   - `Authorization: Bearer <session>` — the signed-in user's token, when the
 *     call happens inside a browser request (needed for user/admin routes);
 *   - `X-Internal-Token` — the shared service token (INTERNAL_API_TOKEN), so
 *     background jobs that outlive the request (people/company collect, verify
 *     passes) still authenticate. It never grants admin-only routes.
 */
import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";

const INTERNAL_TOKEN = (process.env.INTERNAL_API_TOKEN ?? "").trim();

export async function sessionToken(): Promise<string | null> {
  try {
    return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  } catch {
    // Outside a request scope (background job) — there is no user cookie.
    return null;
  }
}

/** Bearer auth header for the current session, or empty when signed out. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await sessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Service-token header (empty when INTERNAL_API_TOKEN is not configured). */
export function internalHeaders(): Record<string, string> {
  return INTERNAL_TOKEN ? { "X-Internal-Token": INTERNAL_TOKEN } : {};
}

/** All credentials for a BE-service call: user session (if any) + service token. */
export async function beAuthHeaders(): Promise<Record<string, string>> {
  return { ...internalHeaders(), ...(await authHeaders()) };
}

function mergeHeaders(base: Record<string, string>, extra: HeadersInit | undefined): Headers {
  const h = new Headers(extra);
  for (const [k, v] of Object.entries(base)) if (!h.has(k)) h.set(k, v);
  return h;
}

/**
 * `fetch` for BE-service URLs: identical to fetch() but adds the credentials
 * above (explicit headers passed by the caller win).
 */
export async function beFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, headers: mergeHeaders(await beAuthHeaders(), init.headers) });
}

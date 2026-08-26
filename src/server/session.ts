/**
 * Server-only: read the session token from the HTTP-only cookie so route
 * handlers can forward it to BE-service as an `Authorization: Bearer …` header.
 */
import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";

export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/** Bearer auth header for the current session, or empty when signed out. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await sessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

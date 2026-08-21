/**
 * OpenCorporates collector — REAL. Queries the free OpenCorporates API for the
 * legal registration record: legal name, jurisdiction, company number and
 * incorporation date. Public access is rate-limited; set OPENCORPORATES_API_TOKEN
 * to raise the limits. Picks the best match by name similarity to the input.
 */
import "server-only";
import { fetchViaProxy } from "../proxy-fetch";
import { attempt, fingerprintFor, proxyLabel, sf, toLike, type CollectContext, type SourceResult } from "./context";
import { nameTokens, tokenSimilarity } from "./scoring";
import type { CollectedCompany, CollectionAttempt } from "@/lib/leads/collect-types";

// Rough hint from a free-text location to an OpenCorporates jurisdiction code.
const JURISDICTION_HINT: Record<string, string> = {
  singapore: "sg", sg: "sg",
  australia: "au", au: "au",
  "united kingdom": "gb", uk: "gb", england: "gb", london: "gb",
  "united states": "us", usa: "us", us: "us",
  canada: "ca", germany: "de", france: "fr", netherlands: "nl", ireland: "ie", "new zealand": "nz", india: "in",
};

function jurisdictionHint(location: string): string | undefined {
  const l = location.toLowerCase();
  for (const [k, v] of Object.entries(JURISDICTION_HINT)) if (l.includes(k)) return v;
  return undefined;
}

interface OcCompany {
  name?: string; company_number?: string; jurisdiction_code?: string;
  incorporation_date?: string; registered_address_in_full?: string;
}

export async function collectOpenCorporates(ctx: CollectContext): Promise<SourceResult> {
  const { inputName, inputLocation, rotator } = ctx;
  const fields: Partial<CollectedCompany> = {};
  const token = process.env.OPENCORPORATES_API_TOKEN?.trim();
  const hint = jurisdictionHint(inputLocation);
  const params = new URLSearchParams({ q: inputName, per_page: "20" });
  if (hint) params.set("jurisdiction_code", hint);
  if (token) params.set("api_token", token);
  const url = `https://api.opencorporates.com/v0.4/companies/search?${params.toString()}`;

  const proxy = rotator.next(`oc:${inputName}`);
  const res = await fetchViaProxy(url, toLike(proxy), { timeoutMs: 10_000, maxBytes: 300_000, fingerprint: fingerprintFor(`oc:${inputName}`), headers: { Accept: "application/json" } });

  const mk = (status: CollectionAttempt["status"], detail: string): CollectionAttempt =>
    attempt("opencorporates", status, proxyLabel(proxy), res.ms, Object.keys(fields).length, { detail });

  if (!res.ok) {
    const status: CollectionAttempt["status"] = res.status === 401 || res.status === 403 ? "blocked" : res.status === 429 ? "rate_limited" : "skipped";
    return { fields, attempt: mk(status, res.status ? `HTTP ${res.status}` : "unreachable"), rateLimited: status === "rate_limited" ? 1 : 0 };
  }

  let companies: OcCompany[] = [];
  try {
    const json = JSON.parse(res.body) as { results?: { companies?: { company?: OcCompany }[] } };
    companies = (json.results?.companies ?? []).map((c) => c.company).filter(Boolean) as OcCompany[];
  } catch { return { fields, attempt: mk("skipped", "unparseable response") }; }

  if (!companies.length) return { fields, attempt: mk("ok", "no registry match") };

  const nTokens = nameTokens(inputName);
  let best: OcCompany | null = null;
  let bestScore = -1;
  for (const c of companies) {
    const score = tokenSimilarity(nTokens, nameTokens(c.name ?? ""));
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best || bestScore < 0.34) return { fields, attempt: mk("ok", "no confident match") };

  if (best.name) fields.legalName = sf(best.name, "opencorporates");
  if (best.jurisdiction_code) fields.jurisdiction = sf(best.jurisdiction_code.toUpperCase(), "opencorporates");
  if (best.company_number) fields.registrationNumber = sf(best.company_number, "opencorporates");
  if (best.incorporation_date) {
    const yr = Number(best.incorporation_date.slice(0, 4));
    if (Number.isFinite(yr) && yr > 1800) fields.incorporated = sf(yr, "opencorporates");
  }
  if (best.registered_address_in_full) fields.address = sf(best.registered_address_in_full, "opencorporates");

  return { fields, attempt: mk("ok", best.name ? `matched "${best.name}"` : "matched") };
}

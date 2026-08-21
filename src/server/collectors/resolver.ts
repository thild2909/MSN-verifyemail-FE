/**
 * Company Resolver — the linchpin. Before crawling anything, search for the
 * company's REAL website and LinkedIn company page, the way Apollo/Clay do,
 * instead of guessing a domain from the name. Runs a few targeted queries,
 * scores every organic result, and keeps the best website + best LinkedIn.
 */
import "server-only";
import { companyToDomain } from "./company-domain";
import { getSearchProvider, type SearchResult } from "../search";
import { attempt, type CollectContext } from "./context";
import { scoreCandidate } from "./scoring";
import type { CollectionAttempt, ResolutionInfo } from "@/lib/leads/collect-types";

// Hosts that are never the company's own website (aggregators, socials, portals).
const NON_WEBSITE = /(^|\.)(linkedin|facebook|twitter|x|instagram|youtube|tiktok|wikipedia|crunchbase|bloomberg|glassdoor|indeed|yelp|zoominfo|apollo|rocketreach|dnb|opencorporates|google|bing|duckduckgo|amazon|medium|github|pinterest|reddit|yellowpages|yell|maps\.google)\.[a-z.]+$/i;

function hostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./i, ""); } catch { return ""; }
}

function firstLinkedIn(results: SearchResult[]): string | null {
  for (const r of results) {
    const m = r.url.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/[A-Za-z0-9_%-]+/i);
    if (m) return m[0].replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }
  return null;
}

export interface ResolveOutput {
  resolution: ResolutionInfo;
  attempt: CollectionAttempt;
}

export async function resolveCompany(ctx: CollectContext): Promise<ResolveOutput> {
  const { inputName, inputLocation, rotator } = ctx;
  const provider = getSearchProvider(rotator);
  const queries = [
    `${inputName} ${inputLocation}`.trim(),
    `${inputName} official website`,
    `${inputName} LinkedIn`,
  ];

  let bestWebsite: { host: string; score: number; query: string } | null = null;
  let linkedin: string | null = null;
  const all: SearchResult[] = [];
  let ms = 0;
  let proxy: string | null = null;
  let anyResults = false;
  let blocked = false;

  for (const q of queries) {
    const resp = await provider.search(q);
    ms += resp.ms;
    proxy = resp.proxy ?? proxy;
    if (resp.blocked) blocked = true;
    if (!resp.results.length) continue;
    anyResults = true;
    all.push(...resp.results);

    if (!linkedin) linkedin = firstLinkedIn(resp.results);

    for (const r of resp.results) {
      const host = hostname(r.url);
      if (!host || NON_WEBSITE.test(host)) continue;
      const score = scoreCandidate(inputName, inputLocation, r);
      if (!bestWebsite || score > bestWebsite.score) bestWebsite = { host, score, query: q };
    }
    // A strong domain match is enough — stop querying to stay polite and avoid
    // tripping the search engine's rate limit (LinkedIn is usually recovered
    // from the website crawl anyway).
    if (bestWebsite && bestWebsite.score >= 0.6) break;
  }

  if (!linkedin) linkedin = firstLinkedIn(all);

  // Fallback: if search returned nothing usable, fall back to the old name→domain
  // guess so the pipeline still produces a (lower-confidence) target.
  let provStr = provider.name;
  let website: string | null = bestWebsite ? bestWebsite.host : null;
  let confidence = bestWebsite ? Math.round(Math.min(1, bestWebsite.score + 0.15) * 100) : 0;
  const winningQuery = bestWebsite?.query ?? queries[0];

  if (!website) {
    const guess = companyToDomain(inputName);
    if (guess) { website = guess; provStr = "guess"; confidence = 25; }
  }
  if (linkedin && confidence < 40) confidence = 40; // a real LinkedIn hit is meaningful on its own

  const resolution: ResolutionInfo = {
    website,
    linkedin,
    confidence,
    provider: provStr,
    query: winningQuery,
    cacheHit: false,
  };

  // Success wins: only report "blocked" when we got nothing usable at all.
  const status: CollectionAttempt["status"] = website || anyResults ? "ok" : blocked ? "blocked" : "skipped";
  const detail = website
    ? `${provStr}: ${website}${linkedin ? " + linkedin" : ""} (${confidence}%)`
    : `${provStr}: no match`;
  const att = attempt("search", status, proxy, ms, (website ? 1 : 0) + (linkedin ? 1 : 0), { provider: provStr, detail });

  return { resolution, attempt: att };
}

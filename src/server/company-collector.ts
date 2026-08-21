/**
 * Company multi-source collector — orchestrator.
 *
 * Pipeline (Apollo/Clay-style):
 *   cache → Resolver (find REAL website + LinkedIn) → Sources (website crawl,
 *   OpenCorporates, simulated LinkedIn/Maps/directory) → Merge (agreement raises
 *   confidence) → cache. The resolver replaces the old name→domain guess, so
 *   every downstream fetch targets the real site.
 *
 * REAL sources: resolver (DuckDuckGo, or a SERP API when SEARCH_API_KEY is set),
 * website crawl, OpenCorporates. SIMULATED (badged): LinkedIn, Google Maps,
 * directory — each behind the same Source interface for a later real swap-in.
 */
import "server-only";
import { initials } from "@/lib/utils";
import { ProxyRotator, sf, type CollectContext, type Cfg } from "./collectors/context";
import { resolveCompany } from "./collectors/resolver";
import { collectWebsite } from "./collectors/website";
import { collectOpenCorporates } from "./collectors/opencorporates";
import { collectLinkedIn, collectGoogleMaps, collectDirectory } from "./collectors/simulated";
import { mergeFields } from "./collectors/merge";
import { getCached, setCached } from "./collectors/cache";
import { attempt } from "./collectors/context";
import type { CollectedCompany, CollectionAttempt } from "@/lib/leads/collect-types";

export { ProxyRotator };

export interface CollectResult { company: Omit<CollectedCompany, "id" | "jobId">; rateLimited: number }

function hostOf(website: string | null): string {
  if (!website) return "";
  try { return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./i, ""); }
  catch { return website.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0]; }
}

export async function collectCompany(inputName: string, inputLocation: string, cfg: Cfg, rotator: ProxyRotator): Promise<CollectResult> {
  // 1) Cache — a hit skips the whole pipeline.
  const cached = getCached(inputName, inputLocation);
  if (cached) {
    const company: Omit<CollectedCompany, "id" | "jobId"> = {
      ...cached.company,
      resolution: cached.company.resolution ? { ...cached.company.resolution, cacheHit: true } : null,
      collection: [attempt("search", "ok", null, 0, 0, { cacheHit: true, detail: "served from 30-day cache" }), ...cached.company.collection],
    };
    return { company, rateLimited: 0 };
  }

  const ctx: CollectContext = { inputName, inputLocation, cfg, rotator, resolved: { website: null, linkedin: null } };
  const attempts: CollectionAttempt[] = [];
  let rateLimited = 0;

  // 2) Resolve the real website + LinkedIn.
  const { resolution, attempt: searchAttempt } = await resolveCompany(ctx);
  attempts.push(searchAttempt);
  ctx.resolved = { website: resolution.website, linkedin: resolution.linkedin };

  // Resolver-provided fields (lowest-friction truth: the domain + a real LinkedIn).
  const resolverFields: Partial<CollectedCompany> = {};
  if (resolution.website) resolverFields.website = sf(hostOf(resolution.website), "search");
  if (resolution.linkedin) resolverFields.linkedin = sf(resolution.linkedin, "search");

  // 3) Run the sources. Website + OpenCorporates are real & independent → parallel.
  const [web, oc] = await Promise.all([collectWebsite(ctx), collectOpenCorporates(ctx)]);
  const li = collectLinkedIn(ctx);
  const maps = collectGoogleMaps(ctx);
  const dir = collectDirectory(ctx);

  for (const r of [web, oc, li, maps, dir]) {
    attempts.push(r.attempt);
    rateLimited += r.rateLimited ?? 0;
  }

  // 4) Merge in priority order (real before simulated); agreement boosts confidence.
  const merged = mergeFields([resolverFields, web.fields, oc.fields, li.fields, maps.fields, dir.fields]);

  const enrichedAny = Object.keys(merged).length > 0;
  const domainGuess = hostOf(resolution.website);
  const company: Omit<CollectedCompany, "id" | "jobId"> = {
    inputName, inputLocation, domainGuess, logoText: initials(inputName),
    status: enrichedAny ? "enriched" : "not_found",
    resolution,
    website: merged.website ?? null, emailDomain: merged.emailDomain ?? null, contactEmail: merged.contactEmail ?? null,
    phone: merged.phone ?? null, linkedin: merged.linkedin ?? null, twitter: merged.twitter ?? null, facebook: merged.facebook ?? null,
    address: merged.address ?? null, mapsRating: (merged.mapsRating as CollectedCompany["mapsRating"]) ?? null,
    industry: merged.industry ?? null, employees: merged.employees ?? null, revenue: merged.revenue ?? null,
    founded: (merged.founded as CollectedCompany["founded"]) ?? null, description: merged.description ?? null,
    technologies: (merged.technologies as CollectedCompany["technologies"]) ?? null,
    legalName: merged.legalName ?? null, jurisdiction: merged.jurisdiction ?? null,
    registrationNumber: merged.registrationNumber ?? null, incorporated: (merged.incorporated as CollectedCompany["incorporated"]) ?? null,
    emailVerification: null,
    collection: attempts,
  };

  // 5) Cache the result (even "not_found" — avoids re-crawling a dead lookup).
  setCached(inputName, inputLocation, company, rateLimited);

  return { company, rateLimited };
}

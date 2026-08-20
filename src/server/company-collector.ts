/**
 * Company multi-source collector.
 *
 * The WEBSITE source is REAL: we fetch the company homepage through a rotating
 * proxy (via curl) and parse emails / phone / social links / title from the
 * HTML. Rotation, retry and backoff on failure are real. The other sources
 * (LinkedIn, Google Maps, social, other) stay SIMULATED — those are gated /
 * ToS-protected, so their field values are deterministic mock. Every attempt is
 * logged with the proxy that served it, latency and outcome.
 */
import "server-only";
import { seededRandom, initials } from "@/lib/utils";
import { companyToDomain } from "./enrichment-engine";
import { fetchViaProxy, type ProxyLike } from "./proxy-fetch";
import { COLLECTION_SOURCES, type CollectedCompany, type CollectionAttempt, type CollectionSource, type SourcedField } from "@/lib/leads/collect-types";

interface StoredProxy { id: string; label: string; host: string; port: number; type: "http" | "https" | "socks5"; username?: string; password?: string; enabled: boolean; status: string }
interface Cfg { enabled: boolean; rotation: string; delayMs: number; backoffMs: number; maxRetries: number; proxies: StoredProxy[] }

const SOURCE_CONFIDENCE: Record<CollectionSource, number> = { linkedin: 90, website: 95, google_maps: 80, social: 70, other: 65 };
const INDUSTRIES = ["Software", "Fintech", "E-commerce", "Healthcare", "Marketing & Advertising", "Manufacturing", "Logistics", "Cybersecurity", "Education", "Real Estate"];
const SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000"];
const REVENUES = ["$1M-$5M", "$5M-$10M", "$10M-$50M", "$50M-$100M", "$100M+"];
const TECHS = ["AWS", "Python", "React", "Kubernetes", "Snowflake", "Node.js", "GCP", "HubSpot", "Segment", "Salesforce"];
const pick = <T>(pool: T[], seed: string): T => pool[Math.floor(seededRandom(seed) * pool.length)];
const sampleTech = (seed: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < TECHS.length && out.length < 4; i++) if (seededRandom(`${seed}:${i}`) < 0.4) out.push(TECHS[i]);
  return out.length ? out : [pick(TECHS, seed + ":f")];
};

/* ------------------------------ proxy rotation --------------------------- */

export class ProxyRotator {
  private i = 0;
  rotations = 0;
  private pool: StoredProxy[];
  constructor(private cfg: Cfg) {
    this.pool = cfg.enabled ? cfg.proxies.filter((p) => p.enabled && p.status !== "dead") : [];
  }
  get active() { return this.pool.length > 0; }
  next(key: string): StoredProxy | null {
    if (this.pool.length === 0) return null;
    let idx: number;
    if (this.cfg.rotation === "random") idx = Math.floor(seededRandom(`${key}:${this.i}`) * this.pool.length);
    else if (this.cfg.rotation === "sticky_per_domain") idx = Math.floor(seededRandom(key) * this.pool.length);
    else idx = this.i % this.pool.length;
    this.i++;
    return this.pool[idx];
  }
}

const proxyLabel = (p: StoredProxy | null): string | null => (p ? `${p.label} (${p.host}:${p.port})` : null);
const toLike = (p: StoredProxy | null): ProxyLike | null => (p ? { type: p.type, host: p.host, port: p.port, username: p.username, password: p.password } : null);
const sf = <T>(value: T, source: CollectionSource): SourcedField<T> => ({ value, source, confidence: SOURCE_CONFIDENCE[source] });
const attempt = (source: CollectionSource, status: CollectionAttempt["status"], proxy: string | null, ms: number, fieldsFound: number): CollectionAttempt => ({ source, status, proxy, ms, fieldsFound });

/* ---------------------------- real website fetch ------------------------- */

interface WebsiteData { email?: string; phone?: string; linkedin?: string; twitter?: string; facebook?: string; title?: string }

function parseWebsite(body: string, domain: string): WebsiteData {
  const data: WebsiteData = {};
  const PLACEHOLDER = /^(you|name|user|email|your|first\.last|john\.doe)@(domain|example|email|company)\.(com|org)$/i;
  const emails = Array.from(body.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)).map((m) => m[0].toLowerCase())
    .filter((e) => !/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(e) && !PLACEHOLDER.test(e) && !e.includes("sentry") && !e.includes("wixpress"));
  const email = emails.find((e) => e.endsWith(`@${domain}`)) ?? emails[0];
  if (email) data.email = email;
  const li = body.match(/https?:\/\/(?:[a-z]+\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9_-]+/i);
  if (li) data.linkedin = li[0].replace(/^https?:\/\//i, "");
  const tw = body.match(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{2,})/i);
  if (tw && !/\/(share|intent|home)$/i.test(tw[0])) data.twitter = `@${tw[1]}`;
  const fb = body.match(/https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9.\-]{2,})/i);
  if (fb && !/(sharer|dialog|plugins)/i.test(fb[0])) data.facebook = fb[0].replace(/^https?:\/\//i, "");
  const tel = body.match(/tel:(\+?[0-9()\-\s]{7,})/i);
  if (tel) data.phone = tel[1].replace(/\s+/g, " ").trim();
  const title = body.match(/<title[^>]*>([^<]{1,140})<\/title>/i);
  if (title) data.title = title[1].replace(/\s+/g, " ").trim();
  return data;
}

async function collectWebsite(domain: string, cfg: Cfg, rotator: ProxyRotator): Promise<{ attempt: CollectionAttempt; fields: Partial<CollectedCompany>; rateLimited: number }> {
  const fields: Partial<CollectedCompany> = {};
  if (!domain) return { attempt: attempt("website", "skipped", null, 0, 0), fields, rateLimited: 0 };

  let proxy = rotator.next(domain);
  let totalMs = 0;
  let rateLimited = 0;
  let retries = 0;
  let status: CollectionAttempt["status"] = "ok";

  for (;;) {
    const res = await fetchViaProxy(`https://${domain}`, toLike(proxy), { timeoutMs: 9000, maxBytes: 300_000 });
    totalMs += res.ms;
    if (res.ok) {
      const p = parseWebsite(res.body, domain);
      fields.website = sf(domain, "website");
      fields.emailDomain = sf(domain, "website");
      if (p.email) fields.contactEmail = sf(p.email, "website");
      if (p.phone) fields.phone = sf(p.phone, "website");
      if (p.linkedin) fields.linkedin = sf(p.linkedin, "website");
      if (p.twitter) fields.twitter = sf(p.twitter, "website");
      if (p.facebook) fields.facebook = sf(p.facebook, "website");
      if (p.title) fields.description = sf(p.title, "website");
      status = retries > 0 ? "retried" : "ok";
      break;
    }
    const throttled = res.status === 429;
    const blocked = res.status === 403;
    if (throttled) rateLimited++;
    // Retry (rotate to a fresh IP) on throttle or transient/connection errors.
    const transient = throttled || res.status === null || (res.status !== null && res.status >= 500);
    if (transient && retries < cfg.maxRetries && rotator.active) {
      retries++; rotator.rotations++; proxy = rotator.next(domain); totalMs += cfg.backoffMs;
      continue;
    }
    status = blocked ? "blocked" : throttled ? "rate_limited" : "skipped";
    break;
  }
  return { attempt: attempt("website", status, proxyLabel(proxy), totalMs, Object.keys(fields).length), fields, rateLimited };
}

/* ------------------------- simulated (gated) sources --------------------- */

function simulate(source: CollectionSource, domain: string, cfg: Cfg, rotator: ProxyRotator): { attempt: CollectionAttempt; rateLimited: number; productive: boolean } {
  let proxy = rotator.next(domain);
  let ms = 60 + Math.floor(seededRandom(`${domain}:${source}:lat`) * 500) + cfg.delayMs;
  let rateLimited = 0;
  let retries = 0;
  const rlChance = rotator.active ? 0.1 : 0.4;
  let r = seededRandom(`${domain}:${source}:rl`);
  while (r < rlChance && retries < cfg.maxRetries) {
    rateLimited++; rotator.rotations++; retries++; proxy = rotator.next(domain); ms += cfg.backoffMs;
    r = seededRandom(`${domain}:${source}:rl:${retries}`);
  }
  let status: CollectionAttempt["status"] = retries > 0 ? "retried" : "ok";
  if (r < rlChance) status = "rate_limited";
  if ((source === "linkedin" || source === "google_maps") && !rotator.active && seededRandom(`${domain}:${source}:block`) < 0.35) status = "blocked";
  const productive = status === "ok" || status === "retried";
  return { attempt: attempt(source, status, proxyLabel(proxy), ms, 0), rateLimited, productive };
}

/* -------------------------------- pipeline ------------------------------- */

export interface CollectResult { company: Omit<CollectedCompany, "id" | "jobId">; rateLimited: number }

export async function collectCompany(inputName: string, inputLocation: string, cfg: Cfg, rotator: ProxyRotator): Promise<CollectResult> {
  const domain = companyToDomain(inputName);
  const slug = domain.split(".")[0] || inputName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const attempts: CollectionAttempt[] = [];
  let rateLimited = 0;

  const acc: Partial<CollectedCompany> = {};
  const setIf = <K extends keyof CollectedCompany>(k: K, v: CollectedCompany[K] | null | undefined) => { if (v && !acc[k]) acc[k] = v; };

  for (const source of COLLECTION_SOURCES) {
    if (source === "website") {
      // REAL fetch through the proxy.
      const w = await collectWebsite(domain, cfg, rotator);
      rateLimited += w.rateLimited;
      attempts.push(w.attempt);
      for (const [k, v] of Object.entries(w.fields)) setIf(k as keyof CollectedCompany, v as never);
      continue;
    }
    // SIMULATED sources.
    const sim = simulate(source, domain || slug, cfg, rotator);
    rateLimited += sim.rateLimited;
    attempts.push(sim.attempt);
    if (sim.productive && domain) {
      switch (source) {
        case "linkedin":
          setIf("linkedin", sf(`linkedin.com/company/${slug}`, source));
          setIf("industry", sf(pick(INDUSTRIES, `${domain}:ind`), source));
          setIf("employees", sf(pick(SIZES, `${domain}:size`), source));
          setIf("founded", sf(1990 + Math.floor(seededRandom(`${domain}:founded`) * 33), source));
          setIf("description", sf(`${inputName} — ${pick(INDUSTRIES, `${domain}:ind`).toLowerCase()} company based in ${inputLocation}.`, source));
          attempts[attempts.length - 1].fieldsFound = 5;
          break;
        case "google_maps":
          setIf("address", sf(`${10 + Math.floor(seededRandom(`${domain}:addr`) * 989)} Main St, ${inputLocation}`, source));
          setIf("phone", sf(`+1 ${200 + Math.floor(seededRandom(`${domain}:p1`) * 799)} ${100 + Math.floor(seededRandom(`${domain}:p2`) * 899)} ${1000 + Math.floor(seededRandom(`${domain}:p3`) * 8999)}`, source));
          setIf("mapsRating", sf(Math.round((3.5 + seededRandom(`${domain}:rating`) * 1.5) * 10) / 10, source));
          setIf("website", sf(domain, source));
          attempts[attempts.length - 1].fieldsFound = 3;
          break;
        case "social":
          setIf("twitter", sf(`@${slug}`, source));
          setIf("facebook", sf(`facebook.com/${slug}`, source));
          setIf("technologies", sf(sampleTech(`${domain}:tech`), source));
          attempts[attempts.length - 1].fieldsFound = 3;
          break;
        case "other":
          setIf("revenue", sf(pick(REVENUES, `${domain}:rev`), source));
          setIf("contactEmail", sf(`contact@${domain}`, source));
          attempts[attempts.length - 1].fieldsFound = 2;
          break;
      }
    }
  }

  const enrichedAny = Object.keys(acc).length > 0;
  const company: Omit<CollectedCompany, "id" | "jobId"> = {
    inputName, inputLocation, domainGuess: domain, logoText: initials(inputName),
    status: !domain ? "not_found" : enrichedAny ? "enriched" : "not_found",
    website: acc.website ?? null, emailDomain: acc.emailDomain ?? null, contactEmail: acc.contactEmail ?? null,
    phone: acc.phone ?? null, linkedin: acc.linkedin ?? null, twitter: acc.twitter ?? null, facebook: acc.facebook ?? null,
    address: acc.address ?? null, mapsRating: (acc.mapsRating as SourcedField<number>) ?? null, industry: acc.industry ?? null,
    employees: acc.employees ?? null, revenue: acc.revenue ?? null, founded: (acc.founded as SourcedField<number>) ?? null,
    description: acc.description ?? null, technologies: (acc.technologies as SourcedField<string[]>) ?? null,
    collection: attempts,
  };
  return { company, rateLimited };
}

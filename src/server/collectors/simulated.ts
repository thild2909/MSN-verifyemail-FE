/**
 * Simulated collectors — LinkedIn, Google Maps, business directory.
 *
 * These sources are ToS-gated and would be blocked instantly without a
 * residential-proxy pool / paid API, so their VALUES are deterministic mock
 * (seeded off the domain, so a company always yields the same profile). The
 * rate-limit / retry / proxy-rotation *behaviour* is modelled realistically and
 * every attempt is flagged `simulated: true` so the UI can badge it honestly.
 * Each lives behind the same Source interface as the real ones, so a real
 * implementation can be dropped in later without touching the orchestrator.
 */
import "server-only";
import { seededRandom } from "@/lib/utils";
import { attempt, proxyLabel, sf, type CollectContext, type SourceResult } from "./context";
import { domainLabel } from "./scoring";
import type { CollectedCompany, CollectionAttempt, CollectionSource } from "@/lib/leads/collect-types";

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

/** Model latency + rate-limit/retry/block behaviour for one gated source. */
function behave(source: CollectionSource, seed: string, ctx: CollectContext) {
  const { cfg, rotator } = ctx;
  let proxy = rotator.next(seed);
  let ms = 60 + Math.floor(seededRandom(`${seed}:lat`) * 500) + cfg.delayMs;
  let rateLimited = 0;
  let retries = 0;
  const rlChance = rotator.active ? 0.1 : 0.4;
  let r = seededRandom(`${seed}:rl`);
  while (r < rlChance && retries < cfg.maxRetries) {
    rateLimited++; rotator.rotations++; retries++; proxy = rotator.next(seed); ms += cfg.backoffMs;
    r = seededRandom(`${seed}:rl:${retries}`);
  }
  let status: CollectionAttempt["status"] = retries > 0 ? "retried" : "ok";
  if (r < rlChance) status = "rate_limited";
  if (source !== "directory" && !rotator.active && seededRandom(`${seed}:block`) < 0.35) status = "blocked";
  const productive = status === "ok" || status === "retried";
  return { proxy, ms, rateLimited, status, productive };
}

function seedFor(ctx: CollectContext): string {
  return domainLabel(ctx.resolved.website ?? "") || ctx.inputName.toLowerCase().replace(/[^a-z0-9]/g, "") || "x";
}

export function collectLinkedIn(ctx: CollectContext): SourceResult {
  const fields: Partial<CollectedCompany> = {};
  const seed = seedFor(ctx);
  const b = behave("linkedin", `linkedin:${seed}`, ctx);
  if (b.productive) {
    if (!ctx.resolved.linkedin) fields.linkedin = sf(`linkedin.com/company/${seed}`, "linkedin");
    fields.industry = sf(pick(INDUSTRIES, `${seed}:ind`), "linkedin");
    fields.employees = sf(pick(SIZES, `${seed}:size`), "linkedin");
    fields.founded = sf(1990 + Math.floor(seededRandom(`${seed}:founded`) * 33), "linkedin");
    fields.description = sf(`${ctx.inputName} — ${pick(INDUSTRIES, `${seed}:ind`).toLowerCase()} company based in ${ctx.inputLocation}.`, "linkedin");
    fields.technologies = sf(sampleTech(`${seed}:tech`), "linkedin");
  }
  const att = attempt("linkedin", b.status, proxyLabel(b.proxy), b.ms, Object.keys(fields).length, { simulated: true, detail: "simulated firmographics" });
  return { fields, attempt: att, rateLimited: b.rateLimited };
}

export function collectGoogleMaps(ctx: CollectContext): SourceResult {
  const fields: Partial<CollectedCompany> = {};
  const seed = seedFor(ctx);
  const b = behave("google_maps", `maps:${seed}`, ctx);
  if (b.productive) {
    fields.address = sf(`${10 + Math.floor(seededRandom(`${seed}:addr`) * 989)} Main St, ${ctx.inputLocation}`, "google_maps");
    fields.phone = sf(`+1 ${200 + Math.floor(seededRandom(`${seed}:p1`) * 799)} ${100 + Math.floor(seededRandom(`${seed}:p2`) * 899)} ${1000 + Math.floor(seededRandom(`${seed}:p3`) * 8999)}`, "google_maps");
    fields.mapsRating = sf(Math.round((3.5 + seededRandom(`${seed}:rating`) * 1.5) * 10) / 10, "google_maps");
    if (ctx.resolved.website) fields.website = sf(domainLabel(ctx.resolved.website) ? ctx.resolved.website.replace(/^https?:\/\//, "").replace(/^www\./, "") : ctx.resolved.website, "google_maps");
  }
  const att = attempt("google_maps", b.status, proxyLabel(b.proxy), b.ms, Object.keys(fields).length, { simulated: true, detail: "simulated place listing" });
  return { fields, attempt: att, rateLimited: b.rateLimited };
}

export function collectDirectory(ctx: CollectContext): SourceResult {
  const fields: Partial<CollectedCompany> = {};
  const seed = seedFor(ctx);
  const b = behave("directory", `dir:${seed}`, ctx);
  const loc = ctx.inputLocation.toLowerCase();
  const registry = loc.includes("singapore") ? "ACRA / YellowPages SG" : loc.includes("australia") ? "ABN Lookup / YellowPages AU" : "business directory";
  if (b.productive) {
    fields.revenue = sf(pick(REVENUES, `${seed}:rev`), "directory");
    const dom = domainLabel(ctx.resolved.website ?? "");
    if (dom) fields.contactEmail = sf(`info@${ctx.resolved.website!.replace(/^https?:\/\//, "").replace(/^www\./, "")}`, "directory");
    fields.phone = sf(`+65 ${6000 + Math.floor(seededRandom(`${seed}:dp`) * 3999)} ${1000 + Math.floor(seededRandom(`${seed}:dp2`) * 8999)}`, "directory");
  }
  const att = attempt("directory", b.status, proxyLabel(b.proxy), b.ms, Object.keys(fields).length, { simulated: true, detail: `simulated ${registry}` });
  return { fields, attempt: att, rateLimited: b.rateLimited };
}

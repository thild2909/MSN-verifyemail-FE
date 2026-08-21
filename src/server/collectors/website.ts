/**
 * Website collector — REAL. Crawls the resolved company site (depth ≤ 2: the
 * homepage plus a fixed set of high-signal pages) through the rotating proxy
 * and extracts emails (mailto + JSON-LD + text), phone, social links and the
 * meta title/description. Retries on throttle/transient errors by rotating to a
 * fresh IP + fingerprint.
 */
import "server-only";
import { fetchViaProxy } from "../proxy-fetch";
import { attempt, fingerprintFor, politeDelay, proxyLabel, sf, toLike, type CollectContext, type SourceResult } from "./context";
import type { CollectedCompany, CollectionAttempt } from "@/lib/leads/collect-types";

const CRAWL_PATHS = ["", "/contact", "/contact-us", "/about", "/about-us", "/team", "/careers"];

const PLACEHOLDER = /^(you|name|user|email|your|first\.last|john\.doe|example)@(domain|example|email|company|yoursite|sentry)\.(com|org|io|net)$/i;
const ASSET = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$/i;

interface Parsed {
  emails: string[]; phone?: string; linkedin?: string; twitter?: string; facebook?: string;
  title?: string; description?: string;
}

// A strict email shape; used to trim junk that mailto/JSON escaping can append
// (e.g. "privacy@icims.com\" or "info@x.com%22").
const STRICT_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;

function cleanEmail(raw: string): string | null {
  let e = raw.toLowerCase().trim();
  try { e = decodeURIComponent(e); } catch { /* keep as-is */ }
  const m = e.match(STRICT_EMAIL);
  return m ? m[0] : null;
}

function extractEmails(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(/mailto:([^"'?>\s\\]+)/gi)) { const e = cleanEmail(m[1]); if (e) found.add(e); }
  for (const m of body.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) { const e = cleanEmail(m[0]); if (e) found.add(e); }
  return [...found].filter((e) => !ASSET.test(e) && !PLACEHOLDER.test(e) && !e.includes("sentry") && !e.includes("wixpress") && !e.includes("@example."));
}

function parse(body: string): Parsed {
  const emails = extractEmails(body);
  const p: Parsed = { emails };
  const li = body.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9_%-]+/i);
  if (li) p.linkedin = li[0].replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const tw = body.match(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{2,})/i);
  if (tw && !/\/(share|intent|home)$/i.test(tw[0])) p.twitter = `@${tw[1]}`;
  const fb = body.match(/https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9.\-]{2,})/i);
  if (fb && !/(sharer|dialog|plugins)/i.test(fb[0])) p.facebook = fb[0].replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const tel = body.match(/tel:(\+?[0-9()\-\s]{7,})/i);
  if (tel) p.phone = tel[1].replace(/\s+/g, " ").trim();
  const title = body.match(/<title[^>]*>([^<]{1,140})<\/title>/i);
  if (title) p.title = title[1].replace(/\s+/g, " ").trim();
  const desc = body.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']{1,240})["']/i);
  if (desc) p.description = desc[1].replace(/\s+/g, " ").trim();
  return p;
}

function bestEmail(emails: string[], domain: string): string | undefined {
  const onDomain = emails.filter((e) => e.endsWith(`@${domain}`));
  const rolePref = ["contact@", "info@", "hello@", "sales@", "support@"];
  for (const pre of rolePref) { const hit = onDomain.find((e) => e.startsWith(pre)); if (hit) return hit; }
  return onDomain[0] ?? emails.find((e) => rolePref.some((pre) => e.startsWith(pre))) ?? emails[0];
}

function hostOf(website: string): string {
  try { return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./i, ""); } catch { return website.replace(/^www\./i, ""); }
}

export async function collectWebsite(ctx: CollectContext): Promise<SourceResult> {
  const { cfg, rotator } = ctx;
  const website = ctx.resolved.website;
  const fields: Partial<CollectedCompany> = {};
  if (!website) return { fields, attempt: attempt("website", "skipped", null, 0, 0, { detail: "no resolved domain" }), rateLimited: 0 };

  const domain = hostOf(website);
  const merged: Parsed = { emails: [] };
  let totalMs = 0;
  let rateLimited = 0;
  let pagesOk = 0;
  let lastProxy: string | null = null;
  let status: CollectionAttempt["status"] = "skipped";
  let sawSuccess = false;

  for (const path of CRAWL_PATHS) {
    // Stop early once we have the useful signals; don't hammer every path.
    if (sawSuccess && merged.emails.length && merged.phone && (merged.linkedin || merged.twitter)) break;
    let proxy = rotator.next(domain);
    let retries = 0;
    for (;;) {
      const res = await fetchViaProxy(`https://${domain}${path}`, toLike(proxy), {
        timeoutMs: 9000, maxBytes: 400_000, fingerprint: fingerprintFor(`${domain}${path}`, retries),
      });
      totalMs += res.ms;
      if (res.ok && res.body) {
        const p = parse(res.body);
        merged.emails.push(...p.emails);
        merged.phone ??= p.phone;
        merged.linkedin ??= p.linkedin;
        merged.twitter ??= p.twitter;
        merged.facebook ??= p.facebook;
        if (path === "" || !merged.title) merged.title ??= p.title;
        merged.description ??= p.description;
        pagesOk++; sawSuccess = true;
        status = retries > 0 ? "retried" : status === "skipped" ? "ok" : status;
        break;
      }
      const throttled = res.status === 429;
      if (throttled) rateLimited++;
      const transient = throttled || res.status === null || (res.status !== null && res.status >= 500);
      if (transient && retries < cfg.maxRetries && rotator.active) {
        retries++; rotator.rotations++; proxy = rotator.next(domain); totalMs += cfg.backoffMs; continue;
      }
      if (path === "" && res.status === 403) status = "blocked";
      break;
    }
    lastProxy = proxyLabel(proxy);
    await politeDelay(cfg, domain);
  }

  if (pagesOk > 0) {
    fields.website = sf(domain, "website");
    fields.emailDomain = sf(domain, "website");
    const email = bestEmail([...new Set(merged.emails)], domain);
    if (email) fields.contactEmail = sf(email, "website");
    if (merged.phone) fields.phone = sf(merged.phone, "website");
    if (merged.linkedin) fields.linkedin = sf(merged.linkedin, "website");
    if (merged.twitter) fields.twitter = sf(merged.twitter, "website");
    if (merged.facebook) fields.facebook = sf(merged.facebook, "website");
    if (merged.description || merged.title) fields.description = sf(merged.description || merged.title!, "website");
    if (status === "skipped") status = "ok";
  }

  const att = attempt("website", status, lastProxy, totalMs, Object.keys(fields).length, { pages: pagesOk, detail: `${pagesOk} page${pagesOk === 1 ? "" : "s"} crawled` });
  return { fields, attempt: att, rateLimited };
}

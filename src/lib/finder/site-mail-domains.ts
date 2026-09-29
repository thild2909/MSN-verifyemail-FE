/**
 * Mail domains a company PUBLISHES on its own website.
 *
 * The website domain often has no MX at all (apollo_people (17): 61 rows, 95% Not
 * found) because the company mails from a different domain — and very often says so
 * on the homepage itself: y-intercept.org lists info@y-intercept.net, trendenterprises.com
 * → trendent.com, cliktracks.com → steelclik.com, didisjewellery.com → didisgroup.com.
 * A redirect is the same signal: gobi-gba.vc → gobi.vc, quamam.com → quamwealthgroup.com.
 *
 * This module is the PURE part (HTML → candidate domains) so it can be regression-
 * tested; the caller fetches the page and MX-gates the result. Precision is unchanged:
 * a candidate only ever yields an address that the verifier confirms per mailbox.
 */
import { cleanDomain } from "./patterns";
import { isFreeMailDomain } from "./verify-orchestration";

// Addresses that appear in page source but belong to the site's tooling, not the
// company (Wix error reporting, M365 tenant aliases, template placeholders, …).
const INFRA_DOMAIN_RE =
  /(^|\.)(wixpress\.com|wix\.com|sentry\.io|onmicrosoft\.com|example\.(com|org)|domain\.com|yourdomain\.com|email\.com|company\.com|test\.com|sentry-next\.wixpress\.com|w3\.org|schema\.org|godaddy\.com|cloudflare\.com|squarespace\.com|shopify\.com|mailchimp\.com|hubspot\.com|zendesk\.com|intercom\.io|google\.com|facebook\.com|apple\.com|microsoft\.com|amazonaws\.com|jsdelivr\.net)$/i;
const ASSET_TLD_RE = /\.(png|jpe?g|gif|svg|webp|ico|js|css|map|woff2?|ttf|mp4|pdf)$/i;

/** Strip a leading mail host label: mail.uming.com.tw → uming.com.tw. */
function mailRoot(d: string): string {
  return d.replace(/^(?:mail|email|smtp|mx|webmail)\./, "");
}

/**
 * Candidate company mail domains from a fetched website page, best first:
 * the redirect target (when it left the site), then domains of addresses printed on
 * the page, most-frequent first. The site domain itself is never returned.
 */
export function extractSiteMailDomains(html: string, siteDomain: string, finalHost?: string | null, limit = 3): string[] {
  const site = cleanDomain(siteDomain);
  const out: string[] = [];
  const add = (raw: string) => {
    const d = mailRoot(cleanDomain(raw));
    if (!d || !d.includes(".") || d === site) return;
    if (isFreeMailDomain(d) || INFRA_DOMAIN_RE.test(d) || ASSET_TLD_RE.test(d)) return;
    if (!out.includes(d)) out.push(d);
  };
  if (finalHost) add(finalHost);
  const counts = new Map<string, number>();
  // Decode the common obfuscations (&#64; / %40 / [at]) before matching.
  const text = (html ?? "").replace(/&#0*64;|%40|\s?\[at\]\s?|\s?\(at\)\s?/gi, "@");
  for (const m of text.matchAll(/[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})/gi)) {
    const d = m[1].toLowerCase();
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  for (const [d] of [...counts].sort((a, b) => b[1] - a[1])) add(d);
  return out.slice(0, limit);
}

// Local parts that are role/team mailboxes, never a person's own address. Their
// PATTERN is useless (they carry no name) so Layer 6 uses them only as weak domain
// evidence, never as a person match.
const ROLE_LOCAL_RE =
  /^(info|contact|hello|hi|enquiry|enquiries|inquiry|sales|admin|administrator|support|help|helpdesk|service|services|office|mail|email|general|team|cs|customerservice|care|marketing|media|press|pr|hr|careers|jobs|recruit|recruitment|billing|accounts|accounting|finance|legal|privacy|webmaster|postmaster|noreply|no-reply|donotreply|newsletter|subscribe|feedback|business|bd|partnership|partnerships|invest|investor|investors|ir|reception|frontdesk|booking|reservations|order|orders|shop|store|abuse|security|dpo|compliance)$/i;

export interface SiteEmail {
  email: string;
  local: string; // lower-cased local part, punctuation kept
  domain: string; // cleaned mail domain
  role: boolean; // true = generic role mailbox (info@, sales@ …), not a person
}

/**
 * Every real, company-owned email address PRINTED on a fetched page, de-duplicated,
 * most-frequent first. Layer 6 (people-verify) matches a NAME-tied one to the person
 * (peter.chan@… for Peter Chan) — a genuine published address, not a guess — and uses
 * the rest only to LEARN the domain's convention. Infra/tooling/free-mail addresses and
 * asset-lookalikes are dropped. `keepDomains` limits results to the company's own /
 * mail domains when known (so a stray partner/vendor address on the page isn't taken).
 */
export function extractSiteEmails(html: string, keepDomains?: string[] | null, limit = 40): SiteEmail[] {
  const keep = (keepDomains ?? []).map((d) => cleanDomain(d)).filter(Boolean);
  const text = (html ?? "").replace(/&#0*64;|%40|\s?\[at\]\s?|\s?\(at\)\s?/gi, "@").replace(/\s?\[dot\]\s?|\s?\(dot\)\s?/gi, ".");
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/([a-z0-9._%+-]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})/gi)) {
    const local = m[1].toLowerCase();
    const domain = mailRoot(m[2].toLowerCase());
    if (!domain.includes(".")) continue;
    if (isFreeMailDomain(domain) || INFRA_DOMAIN_RE.test(domain)) continue;
    if (ASSET_TLD_RE.test(`${local}@${domain}`) || /\.(png|jpe?g|gif|svg|webp|ico|js|css)$/i.test(local)) continue;
    if (local.length < 1 || local.length > 40) continue;
    if (keep.length && !keep.some((k) => domain === k || domain.endsWith(`.${k}`) || k.endsWith(`.${domain}`))) continue;
    const email = `${local}@${domain}`;
    counts.set(email, (counts.get(email) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([email]) => {
      const [local, domain] = email.split("@");
      return { email, local, domain, role: ROLE_LOCAL_RE.test(local) };
    });
}

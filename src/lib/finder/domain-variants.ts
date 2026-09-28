/**
 * Sibling / variant email-domain generation.
 *
 * A very common split, especially at startups: the marketing website is the short
 * brand domain (`risingwave.com`) but employee mail lives on a SIBLING domain that
 * carries the legal-entity suffix or a different TLD — `risingwave-labs.com`,
 * `risingwavelabs.com`, `risingwave.io`, `risingwave.ai`, … (the incorporated name
 * is "RisingWave Labs, Inc."). None of the finder's other layers generate these:
 * L1/L4 key off the website domain, and the L2 support-email lookup usually returns
 * the website domain itself (`contact@risingwave.com`), which is then discarded as
 * "same as website".
 *
 * This module derives those candidate sibling domains DETERMINISTICALLY (no SERP /
 * SMTP / LLM). The caller MX-gates them (cheap DNS) and feeds the survivors into the
 * SAME verification layers — so precision is unchanged (a live-but-wrong variant can
 * never confirm the person's actual mailbox), it only widens the domain set.
 */
import { cleanDomain, cleanToken } from "./patterns";

// Corporate suffixes a company appends to its brand for the legal-entity / mail
// domain, most-common first. High-signal ones (labs/inc/hq) are interleaved ahead
// of the alternate-TLD swaps below; the rest form the long tail.
const CORP_SUFFIXES_TOP = ["labs", "inc", "hq"];
const CORP_SUFFIXES_TAIL = ["lab", "co", "corp", "group", "tech", "app", "team", "cloud", "global", "io", "ai"];
// Prefixes some companies use for their primary domain (get<brand>.com, …).
const CORP_PREFIXES = ["get", "try", "join", "use", "go"];
// Alternate TLDs the SAME brand label commonly uses for mail when .com is the site,
// most-common first (io/ai/co are the usual startup mail TLDs).
const ALT_TLDS = ["io", "ai", "co", "dev", "app", "tech", "xyz", "net", "com"];

/** First DNS label of a bare domain: "risingwave.com" → "risingwave". */
function baseLabel(domain: string): string {
  const d = cleanDomain(domain);
  const label = d.split(".")[0] ?? "";
  return label.replace(/[^a-z0-9]/g, "");
}

/**
 * Generate candidate sibling / variant domains for a company, best-guess first.
 * `websiteDomain` is the resolved website (e.g. risingwave.com); `companyName` is
 * the display/legal name when known (e.g. "RisingWave Labs") — its extra tokens
 * (Labs / Technologies / …) are strong signals for the mail domain. The website
 * domain itself is never returned. Bounded to `limit` candidates.
 */
export function companyDomainVariants(
  websiteDomain: string | null | undefined,
  companyName?: string | null,
  limit = 30,
  opts: { country?: string | null; companyLinkedin?: string | null } = {},
): string[] {
  const site = cleanDomain(websiteDomain ?? "");
  const base = baseLabel(site);
  // A brand slug from the company name (joined tokens), e.g. "RisingWave Labs" →
  // "risingwavelabs"; and the leading token, "risingwave".
  const nameTokens = (companyName ?? "")
    .split(/[^A-Za-z0-9]+/)
    .map((t) => cleanToken(t))
    .filter((t) => t.length >= 2);
  const nameSlug = nameTokens.join("");
  const nameHead = nameTokens[0] ?? "";
  // Distinct brand roots to build from (base website label leads; name-derived roots
  // add coverage when the name carries the suffix the site drops).
  const roots = [base, nameHead, nameSlug].filter((r, i, a) => r.length >= 2 && a.indexOf(r) === i);
  if (roots.length === 0) return [];

  const out: string[] = [];
  const add = (dom: string) => {
    const d = cleanDomain(dom);
    if (!d || !d.includes(".")) return;
    if (d === site) return; // never re-propose the website domain
    if (!out.includes(d)) out.push(d);
  };

  const addSuffix = (suf: string) => {
    for (const root of roots) {
      if (root.endsWith(suf)) continue; // root already carries the suffix
      add(`${root}-${suf}.com`);
      add(`${root}${suf}.com`);
    }
  };

  // 0. Brand CORE on .com + the region's TLDs (see regionalVariants) — the split
  //    that dominates Asian corporate lists: hangsenginvestment.com → hangseng.com,
  //    westk.hk → wkcd.hk, ea-dg.com.cn → eadg.com, msig.com.hk → msig.com.
  for (const d of regionalVariants(site, companyName, opts)) add(d);
  // 1. Top corporate suffixes on .com, hyphenated + joined (highest signal:
  //    risingwave-labs.com / risingwavelabs.com).
  for (const suf of CORP_SUFFIXES_TOP) addSuffix(suf);
  // 2. Company-name slug itself on .com (name "RisingWave Labs" → risingwavelabs.com
  //    even when the site is the short risingwave.com).
  if (nameSlug && nameSlug !== base) add(`${nameSlug}.com`);
  // 3. Brand on the common startup mail TLDs (risingwave.io / .ai / .co) — ahead of
  //    the long-tail suffixes so a .io/.ai mail domain isn't cut by the cap.
  for (const tld of ALT_TLDS) {
    for (const root of roots) add(`${root}.${tld}`);
  }
  // 4. Long-tail corporate suffixes on .com.
  for (const suf of CORP_SUFFIXES_TAIL) addSuffix(suf);
  // 5. Prefixed brand (get<brand>.com).
  for (const pre of CORP_PREFIXES) {
    for (const root of roots) {
      add(`${pre}${root}.com`);
      add(`${pre}-${root}.com`);
    }
  }

  return out.slice(0, limit);
}

/* ------------------------- regional / brand-core ------------------------- */

// Whole words that describe WHAT a company is rather than WHO — dropped to reach the
// brand core ("Dah Sing Insurance Company Limited" → dahsing). "tech" is deliberately
// absent: it is glued into real brands (Cytech, Wintech).
const GENERIC_WORDS = new Set([
  "the", "and", "of", "limited", "ltd", "company", "co", "corp", "corporation", "inc", "llc", "plc", "pte",
  "group", "holdings", "holding", "investment", "investments", "insurance", "financial", "finance", "fintech",
  "services", "service", "logistics", "cargo", "capital", "partners", "partnership", "management", "asset",
  "consulting", "trading", "enterprises", "enterprise", "manufacturing", "industrial", "industry", "industries",
  "products", "international", "intl", "global", "solutions", "digital", "ventures", "media", "bank", "securities",
  "authority", "hong", "kong", "hongkong", "hk", "asia", "china", "singapore", "sg", "archived",
]);
// Generic words that also appear GLUED to the end of a website label
// (hktfinancialservices, mirumhongkong, aflcargo) — stripped repeatedly.
const GLUED_SUFFIXES = [
  "financialservices", "services", "financial", "investment", "insurance", "logistics", "hongkong", "cargo",
  "holdings", "group", "limited", "international", "asia", "hk", "partners", "capital", "fintech", "ventures",
];
// Company-mail TLDs per country, most common first.
const COUNTRY_TLDS: Array<[RegExp, string[]]> = [
  [/hong\s*kong|\bhk\b/i, ["com.hk", "hk", "asia"]],
  [/china|\bprc\b/i, ["com.cn", "cn"]],
  [/singapore/i, ["com.sg", "sg"]],
  [/taiwan/i, ["com.tw", "tw"]],
  [/japan/i, ["co.jp", "jp"]],
  [/malaysia/i, ["com.my", "my"]],
  [/thailand/i, ["co.th"]],
  [/vietnam|viet nam/i, ["com.vn", "vn"]],
  [/korea/i, ["co.kr"]],
  [/australia/i, ["com.au"]],
  [/india/i, ["co.in", "in"]],
  [/indonesia/i, ["co.id"]],
  [/philippines/i, ["com.ph"]],
  [/united kingdom|\buk\b|england/i, ["co.uk"]],
];

function stripGluedSuffixes(label: string): string {
  let cur = label;
  for (let changed = true; changed; ) {
    changed = false;
    for (const suf of GLUED_SUFFIXES) {
      if (cur.endsWith(suf) && cur.length - suf.length >= 3) {
        cur = cur.slice(0, -suf.length);
        changed = true;
      }
    }
  }
  return cur;
}

/** "msig.com.hk" → "com.hk"; "randoli.io" → "io". */
function publicSuffix(domain: string): string {
  const parts = domain.split(".");
  if (parts.length >= 3 && parts[parts.length - 2].length <= 3) return parts.slice(-2).join(".");
  return parts.slice(-1).join(".");
}

/** Latin-only word tokens of a company name. */
function nameWords(name: string | null | undefined): string[] {
  return (name ?? "")
    .replace(/\([^)]*\)/g, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Brand-core roots for a company, best first:
 *   • website label minus glued generic suffixes (hangsenginvestment → hangseng) and
 *     its first hyphen segment (gobi-gba → gobi);
 *   • company-name core (generic words dropped): "Dah Sing Insurance" → dahsing;
 *   • a parenthesised short name: "Earthasia Design Group (EADG)" → eadg;
 *   • the company LinkedIn slug core: /company/msighk → msig, gobipartners → gobi;
 *   • the initials of the core words: "West Kowloon Cultural District Authority" → wkcd.
 */
export function brandCoreRoots(
  websiteDomain: string | null | undefined,
  companyName?: string | null,
  companyLinkedin?: string | null,
): string[] {
  const site = cleanDomain(websiteDomain ?? "");
  const rawLabel = site.split(".")[0] ?? "";
  const label = rawLabel.replace(/[^a-z0-9]/g, "");
  const roots: string[] = [];
  const push = (r: string | undefined | null) => {
    const v = (r ?? "").replace(/[^a-z0-9]/g, "");
    if (v.length >= 3 && !GENERIC_WORDS.has(v) && !roots.includes(v)) roots.push(v);
  };
  push(label);
  push(stripGluedSuffixes(label));
  if (rawLabel.includes("-")) push(rawLabel.split("-")[0]);

  const words = nameWords(companyName);
  const core = words.filter((w) => !GENERIC_WORDS.has(w));
  if (core.length) {
    push(core.join(""));
    push(core[0]);
  }
  for (const m of (companyName ?? "").matchAll(/\(([^)]{2,20})\)/g)) {
    const t = m[1].trim();
    if (isShortNameAcronym(t)) push(t.toLowerCase());
  }
  const slug = decodeURIComponent((companyLinkedin ?? "").match(/linkedin\.com\/company\/([^/?#]+)/i)?.[1] ?? "").toLowerCase();
  if (/^[a-z0-9-]+$/.test(slug)) {
    const parts = slug.split("-").filter(Boolean);
    const coreParts = parts.filter((w) => !GENERIC_WORDS.has(w));
    push(stripGluedSuffixes(parts.join("")));
    if (coreParts.length) push(coreParts[0]);
    const g = parts.join("").replace(/(partners|hk|group|limited|ltd)$/, "");
    push(g);
  }
  // Initials only at 4+ letters: 3-letter acronyms (lac, mic, dsj) are mostly OTHER companies.
  const pushAcr = (a: string) => { if (a.length >= 4) push(a); };
  if (core.length >= 3) {
    pushAcr(core.map((w) => w[0]).join(""));
    const lastDropped = words.filter((w) => !GENERIC_WORDS.has(w) || w === "authority" || w === "group");
    if (lastDropped.length > core.length) pushAcr(lastDropped.map((w) => w[0]).join(""));
  }
  return roots;
}

/** Brand-core roots × (.com, the country's TLDs, the website's own suffix). */
export function regionalVariants(
  websiteDomain: string | null | undefined,
  companyName?: string | null,
  opts: { country?: string | null; companyLinkedin?: string | null } = {},
): string[] {
  const site = cleanDomain(websiteDomain ?? "");
  const tlds = ["com"];
  for (const [re, list] of COUNTRY_TLDS) if (opts.country && re.test(opts.country)) tlds.push(...list);
  if (site) tlds.push(publicSuffix(site));
  const uniqTlds = tlds.filter((t, i, a) => a.indexOf(t) === i);
  const out: string[] = [];
  for (const root of brandCoreRoots(site, companyName, opts.companyLinkedin)) {
    for (const tld of uniqTlds) {
      const d = `${root}.${tld}`;
      if (d !== site && !out.includes(d)) out.push(d);
    }
  }
  return out;
}

/* ------------------------------ relevance gate ------------------------------ */

const alnum = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

/**
 * A live variant is only USED when it is plausibly the same company: a TLD swap of
 * the exact website label (randoli.io → randoli.com), or a domain whose homepage
 * names the company. Generic roots otherwise pull in unrelated businesses
 * (crickethongkong → cricket.com, "Two Eight One" → two.com, "West Kowloon" →
 * west.com) where a common name like david.chan@ could verify as someone else.
 */
// TLDs a real company mails from; .ai/.xyz/.dev/.app swaps are mostly parked domains.
const STRONG_SWAP_TLD_RE = /\.(com|net|org|co|io|asia|hk|com\.hk|org\.hk|cn|com\.cn|sg|com\.sg|tw|com\.tw|jp|co\.jp|my|com\.my|co\.th|vn|com\.vn|co\.kr|com\.au|co\.uk|co\.in|co\.id|com\.ph)$/;

export function sameLabelVariant(variant: string, websiteDomain: string | null | undefined): boolean {
  const site = cleanDomain(websiteDomain ?? "");
  const v = cleanDomain(variant);
  const a = alnum(v.split(".")[0] ?? "");
  const b = alnum(site.split(".")[0] ?? "");
  return a.length >= 5 && a === b && STRONG_SWAP_TLD_RE.test(v);
}

/** "(EADG)" is a short name; "(Europe)", "(MagIC)", "(Holdings)" are not. */
function isShortNameAcronym(t: string): boolean {
  return /^[A-Z][A-Z0-9&]{2,7}$/.test(t);
}

/**
 * Structural proof the variant is THIS company, no page fetch needed: the exact
 * website label on another TLD (randoli.io → randoli.com), the joined name core of
 * 2+ words ("Hang Seng Investment" → hangseng.com, "Dah Sing Insurance" → dahsing.com),
 * a parenthesised short name ("(EADG)" → eadg.com) or the company LinkedIn slug.
 * A bare single word (cricket, west, two) never qualifies here.
 */
export function strongVariantMatch(
  variant: string,
  ctx: { websiteDomain?: string | null; companyName?: string | null; companyLinkedin?: string | null },
): boolean {
  if (sameLabelVariant(variant, ctx.websiteDomain)) return true;
  if (!STRONG_SWAP_TLD_RE.test(cleanDomain(variant))) return false;
  const label = alnum(cleanDomain(variant).split(".")[0] ?? "");
  if (label.length < 4) return false;
  const core = nameWords(ctx.companyName).filter((w) => !GENERIC_WORDS.has(w));
  if (core.length >= 2 && label === core.join("")) return true;
  if (core.length >= 2 && label === core.slice(0, 2).join("")) return true;
  for (const m of (ctx.companyName ?? "").matchAll(/\(([^)]{2,20})\)/g)) if (isShortNameAcronym(m[1].trim()) && alnum(m[1]) === label) return true;
  const slug = alnum(decodeURIComponent((ctx.companyLinkedin ?? "").match(/linkedin\.com\/company\/([^/?#]+)/i)?.[1] ?? ""));
  return slug.length >= 5 && label === slug;
}

export function variantPageRelevant(
  html: string,
  ctx: { websiteDomain?: string | null; companyName?: string | null; country?: string | null; variant?: string | null },
): boolean {
  const text = (html ?? "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
  // A parked / for-sale page only repeats its own domain name — never evidence.
  if (/domain (name )?(is|may be) for sale|buy this domain|this domain is parked|parked free|domain parking|sedoparking|dan.com|afternic/i.test(text)) return false;
  // Drop the variant's OWN domain string ("lisboa.io") so a page that merely prints
  // its name doesn't vouch for itself; the brand words themselves stay.
  const ownDomain = cleanDomain(ctx.variant ?? "");
  const blob = alnum(ownDomain ? text.toLowerCase().split(ownDomain).join(" ") : text);
  if (!blob.trim()) return false;
  const site = cleanDomain(ctx.websiteDomain ?? "");
  const label = alnum(site.split(".")[0] ?? "");
  if (site && (text.toLowerCase().includes(site) || (label.length >= 5 && blob.includes(label)))) return true;
  const words = nameWords(ctx.companyName);
  const core = words.filter((w) => !GENERIC_WORDS.has(w));
  // Two+ core words: the joined phrase ("hangseng", "westkowloon") is distinctive.
  if (core.length >= 2) return blob.includes(core.slice(0, 2).join(""));
  // One core word (a bare brand): only the full company name counts — "cricket"
  // alone is on every cricket site, "Cricket Hong Kong" is not.
  const full = words.join("");
  if (core.length === 1 && full.length >= 6 && full !== core[0]) return blob.includes(full);
  // A single-word name (e.g. "Melco") must be distinctive enough on its own.
  if (core.length === 1 && core[0].length >= 5) return blob.includes(core[0]) && !!ctx.country && blob.includes(alnum(ctx.country));
  return false;
}

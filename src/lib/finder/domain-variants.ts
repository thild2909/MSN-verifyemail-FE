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

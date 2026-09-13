/**
 * Email pass for a people-collection job.
 *
 * FINDER-backed: for a person whose email is a pattern guess (or missing), run
 * the same single-email-finder pipeline the Email Finder uses. If no pattern
 * confirms a mailbox, DeepSeek proposes alternate addresses which we SMTP-check
 * before showing. A miss is stored as `not_found` — never as a guessed address
 * marked Invalid.
 *
 * A person whose email was actually scraped from the web (`emailKind: "found"`)
 * is verified directly rather than replaced by a pattern guess.
 */
import "server-only";
import { cachedVerify } from "./verification";
import { VerifierUnavailableError } from "@/lib/verifier/backend";
import { findPersonEmail, cachedDomainClass } from "./finder";
import { cleanDomain } from "@/lib/finder/patterns";
import { bestFullName, detectProfile, generateGlobalCandidates, learnGlobalPattern, learnedGlobalPattern, mergeLocals, splitFirstLast } from "@/lib/finder/global-name-patterns";
import { escalateL5, isDistinctiveLocal, layerContinues, partitionByDomain, scrapedEmailTrusted, titleResolvableForReverseLookup, verifyRanked } from "@/lib/finder/verify-orchestration";
import { analyzeNameEmailStructureViaCrawler, l5WebSearchAvailable, resolveCompanyEmailDomainViaCrawler, resolvePersonEmailsViaCrawler, resolvePersonByRoleViaCrawler } from "./crawler-client";
import type { FinderOutcome, FinderResult, FinderState, BulkFinderResponse, BulkFinderResult } from "@/lib/types";
import type { EmailVerification } from "@/lib/leads/collect-types";
import type { CollectedPerson } from "@/lib/leads/people-types";
import * as store from "./people-collect-store";

/** Persist after every person so the table can show results + in-flight spinners. */
const COMMIT_EVERY = 1;
// Concurrent per-row verifications. This work is I/O-bound (SMTP/SERP waits), so
// far more can run at once than a CPU-bound task; the SMTP backend's capacity is
// the real limit. Raise PEOPLE_VERIFY_CONCURRENCY to go faster if reacher can take
// it. SERP layers are separately throttled by `serpLimit`, so a high row
// concurrency does not flood the crawler.
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.PEOPLE_VERIFY_CONCURRENCY ?? 12), 64));

export interface VerifyPassResult {
  verified: number; // people whose email got a verdict this pass
  valid: number; // confirmed-deliverable
  found: number; // real emails DISCOVERED (upgraded from a guess)
  provider: "reacher" | "none";
}

type PersonPatch = Partial<
  Pick<CollectedPerson, "email" | "emailKind" | "emailVerification" | "companyEmail" | "altName">
>;

const now = () => new Date().toISOString();

// #3 — a shared limiter for the crawler SERP calls (alt-domain / public-sources /
// reverse-role). Row workers run at PEOPLE_VERIFY_CONCURRENCY, and each can fire
// SERP calls; this caps TOTAL in-flight SERP across the whole pass so the crawler
// isn't hammered on a big bulk run. Precision-neutral — it only paces requests.
function makeLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const pump = () => {
    if (active >= max) return;
    const job = queue.shift();
    if (!job) return;
    active++;
    job();
  };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => { active--; pump(); });
      });
      pump();
    });
}
const serpLimit = makeLimiter(Math.max(1, Math.min(Number(process.env.CRAWLER_SERP_CONCURRENCY ?? 6), 24)));

type VerifyOneResult = {
  patch: PersonPatch;
  valid: boolean;
  found: boolean;
  provider: "reacher";
  needsLlm?: boolean;
  // Company support/contact email discovered by the alt-domain layer. Carried
  // top-level (not in `patch`) so it survives the LLM hand-off and is merged in
  // at persist time regardless of the person-email verdict.
  companyEmail?: string;
  // Corrected/fuller name discovered by the name-correction (third) layer.
  // Top-level for the same reason: it must survive an LLM hand-off so the row
  // still shows the correction even when the mailbox never resolves.
  altName?: string;
};

function notFoundPatch(provider: "reacher"): VerifyOneResult {
  return {
    patch: {
      email: null,
      emailKind: "none",
      emailVerification: { email: "", status: "not_found", score: 0, provider, verifiedAt: now() },
    },
    valid: false,
    found: false,
    provider,
  };
}

/** Build the person patch from a finder outcome (pattern-guess / missing case). */
function patchFromFinder(o: FinderOutcome): VerifyOneResult {
  const r = o.result;
  const base: EmailVerification = { email: r.email, status: "unknown", score: r.score, provider: o.provider, verifiedAt: now() };

  if (o.state === "verified") {
    return {
      patch: {
        email: { value: r.email, source: "website", confidence: 90 },
        emailKind: "found",
        emailVerification: { ...base, status: "valid" },
      },
      valid: true,
      found: true,
      provider: o.provider,
    };
  }
  if (o.state === "accept_all") {
    const status = r.status === "unverified" ? "catch_all" : r.status;
    return {
      patch: {
        email: { value: r.email, source: "other", confidence: r.score },
        emailKind: "pattern",
        emailVerification: { ...base, status },
      },
      valid: false,
      found: false,
      provider: o.provider,
    };
  }
  // no_mx / not_found — do not keep the guessed address as "Invalid".
  return notFoundPatch(o.provider);
}

// The company's real email-sending domain may differ from its website domain
// (e.g. mail on a parent/brand domain). On by default; set to "0" to disable.
const ALT_DOMAIN_LAYER = (process.env.PEOPLE_VERIFY_ALT_DOMAIN ?? "1") !== "0";

// Public-sources layer: scrape the person's actually-published email from the
// web (Decodo SERP) when pattern + alt-domain fail. Free tier (a SERP call +
// a few SMTP checks), so on by default; set to "0" to disable.
const PUBLIC_SOURCES_LAYER = (process.env.PEOPLE_VERIFY_PUBLIC_SOURCES ?? "1") !== "0";

// Name-correction (third) layer: when pattern + alt-domain + public sources all
// fail, the stored name may be incomplete/wrong. Look the person up on LinkedIn
// by TITLE + COMPANY, and if the profile carries a DIFFERENT name, re-run the
// email patterns with that corrected name. On by default; set to "0" to disable.
const NAME_CORRECTION_LAYER = (process.env.PEOPLE_VERIFY_NAME_CORRECTION ?? "1") !== "0";

// Layer 4 — culture-aware global name→pattern engine. When every earlier layer
// fails, generate candidates from the person's naming convention (Vietnamese
// given-last, CJK family-first, Hispanic double surname, German umlaut fold, …)
// and SMTP-verify the top few. On by default; set to "0" to disable.
const GLOBAL_PATTERN_LAYER = (process.env.PEOPLE_VERIFY_GLOBAL_PATTERNS ?? "1") !== "0";
// How many culture-aware candidates to SMTP-check (most overlap Layer 1 and hit
// the email cache for free; only the genuinely new formats cost a backend call).
const GLOBAL_PATTERN_MAX = Math.max(4, Math.min(Number(process.env.PEOPLE_VERIFY_GLOBAL_MAX ?? 20), 40));
// How many candidate mailboxes to SMTP-check in parallel within one lookup (after
// the priority-0 candidate is tried alone). I/O-bound, so a handful is safe.
// Keep MODEST: the backend's catch-all confirmation is latency-based, so heavy SMTP
// parallelism distorts the timing and causes false positives. 5 is empirically safe.
const CANDIDATE_CONCURRENCY = Math.max(1, Math.min(Number(process.env.PEOPLE_VERIFY_CANDIDATE_CONCURRENCY ?? 5), 12));

// Per-row wall-clock budget for the INLINE layers. Cheap layers (L1/L4 SMTP, each
// bounded) always run; once a row has spent this long, the expensive SERP layers
// (public-sources, reverse-role) are SKIPPED → the row returns Not found fast
// instead of hanging. Coverage-safe: normal finds resolve well within budget; only
// pathologically slow rows (which rarely find anything anyway) skip the SERP tail.
const ROW_BUDGET_MS = Math.max(5_000, Number(process.env.PEOPLE_VERIFY_ROW_BUDGET_MS ?? 25_000));

/**
 * Public-sources layer: fetch the person's published email candidates from the
 * web and SMTP-verify each in score order. The first backend-confirmed mailbox
 * is the person's real address. Returns a found result, or null when nothing
 * scrapes/confirms — the caller then falls through to the LLM guess.
 */
async function findViaPublicSources(t: store.PersonVerifyTarget): Promise<VerifyOneResult | null> {
  let emails: string[];
  try {
    emails = await serpLimit(() => resolvePersonEmailsViaCrawler({
      name: t.name,
      first: t.firstName,
      last: t.lastName,
      company: t.company,
      domain: t.domain,
      location: t.location,
    }));
  } catch {
    return null;
  }
  for (const email of emails) {
    // Only trust a scraped address on the company's OWN domain (or a free-mail
    // personal address with a full first+last match). A name-matched email on an
    // unrelated domain (mrashid@uwf.edu for a cukrudev.com person) is a namesake —
    // reject it BEFORE spending an SMTP check.
    if (!scrapedEmailTrusted(email, t.domain, t.firstName, t.lastName)) continue;
    let v: Awaited<ReturnType<typeof cachedVerify>>;
    try {
      v = await cachedVerify(email);
    } catch {
      continue;
    }
    if (v.result.status === "valid") {
      return {
        patch: {
          email: { value: email, source: "website", confidence: 85 },
          emailKind: "found",
          emailVerification: { email, status: "valid", score: v.result.score, provider: v.provider, verifiedAt: now() },
        },
        valid: true,
        found: true,
        provider: v.provider,
      };
    }
  }
  return null;
}

/** Accent-stripped, lowercased, single-spaced name for equality checks. */
const normName = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Normalized name tokens (accent-stripped, len ≥ 2) for the shared-token gate. */
function nameTokens(s: string): Set<string> {
  return new Set(
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((t) => t.length >= 2),
  );
}

/**
 * Name-correction (third) layer. Look the person up on LinkedIn by TITLE +
 * COMPANY (not by the stored name). When the profile resolves to a DIFFERENT
 * name that still shares a token with the stored one (a fuller/qualified
 * version, never a wholesale-different person), re-run the email patterns — and
 * the public-sources scrape — under the corrected name. Returns the corrected
 * name plus any confirmed email result (null result = corrected name found but
 * no mailbox, so the caller still surfaces the name and may fall through to LLM).
 */
async function findViaNameCorrection(
  t: store.PersonVerifyTarget,
): Promise<{ altName: string; result: VerifyOneResult | null } | null> {
  if (!t.title || !t.company) return null;
  const title = t.title; // capture narrowed value (closure below loses the narrowing)
  let corr: Awaited<ReturnType<typeof resolvePersonByRoleViaCrawler>>;
  try {
    corr = await serpLimit(() => resolvePersonByRoleViaCrawler({
      title, company: t.company, domain: t.domain, location: t.location, knownName: t.name,
    }));
  } catch {
    return null;
  }
  if (!corr.matched || !corr.changed || !corr.firstName || !corr.lastName) return null;
  const altName = (corr.name ?? `${corr.firstName} ${corr.lastName}`).trim();
  // Precision gate: the correction must overlap the stored name by ≥1 token, so
  // we only ever *extend/fix* a name, never swap in a namesake the role matched.
  const stored = nameTokens(t.name);
  if (![...nameTokens(altName)].some((tok) => stored.has(tok))) return null;

  let result: VerifyOneResult | null = null;
  if (t.domain) {
    const outcome = await findPersonEmail({ firstName: corr.firstName, lastName: corr.lastName, domain: t.domain });
    if (outcome.state === "verified" || outcome.state === "accept_all") result = patchFromFinder(outcome);
  }
  if (!result && PUBLIC_SOURCES_LAYER) {
    const pub = await findViaPublicSources({ ...t, name: altName, firstName: corr.firstName, lastName: corr.lastName }).catch(() => null);
    if (pub) result = pub;
  }
  return { altName, result };
}

/**
 * Layer 4 — culture-aware global patterns. Generate email candidates from the
 * person's naming convention (detected from their country/location + name), rank
 * them (a learned per-domain pattern pinned first), and SMTP-verify the top few
 * in order. The first the backend confirms `valid` is the person's real address;
 * we learn its pattern for the domain so colleagues resolve on the first try.
 * `nameOverride` carries a Layer-3 corrected name when one was found. Returns a
 * found result, or null when nothing confirms (caller falls through to LLM).
 */
async function findViaGlobalPatterns(
  t: store.PersonVerifyTarget,
  domains: string[],
  nameOverride?: string,
): Promise<VerifyOneResult | null> {
  // Prefer a fuller name recovered from the LinkedIn slug (the stored name is
  // often missing a token, e.g. "Lecelyn Bueno" while the slug is
  // kim-lecelyn-bueno → "Kim Lecelyn Bueno" → kimlecelyn.bueno).
  const rawName = (nameOverride || bestFullName(t.name, t.linkedin) || `${t.firstName} ${t.lastName}`).trim();
  if (!rawName) return null;
  const recovered = !nameOverride && normName(rawName) !== normName(t.name) ? rawName : undefined;

  for (const domain of uniqueDomains(domains)) {
    // Skip a domain the finder already classified as unverifiable (catch-all /
    // opaque / dead): a per-candidate SMTP sweep there can't confirm anything, so
    // it's pure wasted time. Cached from Layer 1's probe → free.
    if (cachedDomainClass(domain) !== "ok") continue;
    const learned = learnedGlobalPattern(domain);
    const candidates = generateGlobalCandidates(rawName, {
      country: t.country, domain, learnedPatternId: learned, limit: GLOBAL_PATTERN_MAX,
    });
    if (candidates.length === 0) continue;
    // Ranked-parallel verify: candidate[0] (learned pattern) alone first, the rest
    // in parallel — same winner as sequential, just faster. mxFail → next domain.
    const { winner, mxFail } = await verifyRanked(
      candidates,
      (email) => cachedVerify(email),
      (v) => v.result.status === "valid",
      (v) => v.result.checks.mx === "fail",
      { concurrency: CANDIDATE_CONCURRENCY },
    ).catch(() => ({ winner: null, mxFail: false } as { winner: null; mxFail: boolean }));
    if (mxFail) continue; // dead MX on this domain → try the next
    if (winner) {
      const c = winner.cand;
      let v = winner.result;
      // Confirm-in-isolation: on a catch-all domain the backend tells a real mailbox
      // from a bogus one by RESPONSE LATENCY (target vs. control timing). A `valid`
      // produced DURING the parallel sweep can be a false positive because the
      // concurrent probes distort those timings — we measured `rob@`/`mx@` coming
      // back valid mid-sweep but `risky` when re-checked alone. So if this winner
      // wasn't the isolated priority-0 check, re-run the SAME check once, alone, and
      // require `valid` again before trusting it. (Verify logic is untouched — this
      // just removes the sweep interference.) Real top-ranked hits (candidate[0],
      // e.g. `thild`) skip this and stay fast.
      if (c.email !== candidates[0].email) {
        const confirm = await cachedVerify(c.email, { fresh: true }).catch(() => null);
        if (!confirm || confirm.result.status !== "valid") continue; // sweep artifact → next domain
        v = confirm;
      }
      learnGlobalPattern(domain, c.patternId);
      return {
        patch: {
          email: { value: c.email, source: "other", confidence: 82 },
          emailKind: "found",
          emailVerification: { email: c.email, status: "valid", score: v.result.score, provider: v.provider, verifiedAt: now() },
        },
        valid: true,
        found: true,
        provider: v.provider,
        altName: recovered,
      };
    }
  }
  return null;
}

/** Extract the domain from an email/URL/bare-domain string, or "". */
function domainOf(v: string | null | undefined): string {
  if (!v) return "";
  const at = v.includes("@") ? v.split("@")[1] : v;
  return cleanDomain(at);
}
/** De-duplicated, non-empty domain list preserving order. */
function uniqueDomains(list: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const d of list) {
    const c = cleanDomain(d ?? "");
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * Catch-all handling (#2): on a catch-all domain L1 cannot verify any address, so
 * it surfaces its Western first.last as the best guess. For a NON-Western name
 * that guess is usually the wrong format, so replace the displayed local-part
 * with the culture-aware top pattern (still an unconfirmed catch-all guess).
 */
function overrideAcceptAllGuess(res: VerifyOneResult, t: store.PersonVerifyTarget, effectiveName?: string): VerifyOneResult {
  if (!GLOBAL_PATTERN_LAYER || !t.domain || !res.patch.email) return res;
  // Use the SAME name Layer 1 searched (slug-recovered when fuller), so the shown
  // catch-all guess stays consistent with the address we actually tried.
  const rawName = (effectiveName || t.name || `${t.firstName} ${t.lastName}`).trim();
  if (!rawName || detectProfile(t.country, rawName) === "western") return res;
  const top = generateGlobalCandidates(rawName, { country: t.country, domain: t.domain, limit: 1 })[0];
  if (!top?.email) return res;
  const currentLocal = String(res.patch.email.value).split("@")[0];
  if (top.local === currentLocal) return res;
  const ev = res.patch.emailVerification;
  return {
    ...res,
    patch: {
      ...res.patch,
      email: { ...res.patch.email, value: top.email },
      emailVerification: ev ? { ...ev, email: top.email } : ev,
    },
  };
}

/**
 * Discover the domain a company actually sends mail from AND the published
 * support/contact email it was derived from (Decodo "email support <company>"),
 * memoized per company+location so everyone at one company costs at most ONE SERP
 * lookup. Failures memoize as null. Returns null on any error.
 */
type AltEmailHit = { domain: string | null; email: string | null };
const altDomainMemo = new Map<string, Promise<AltEmailHit | null>>();
function altEmailDomainFor(company: string, location: string | null): Promise<AltEmailHit | null> {
  const key = `${company.toLowerCase().trim()}|${(location ?? "").toLowerCase().trim()}`;
  let p = altDomainMemo.get(key);
  if (!p) {
    if (altDomainMemo.size > 1000) altDomainMemo.clear();
    p = serpLimit(() => resolveCompanyEmailDomainViaCrawler(company, location ?? ""))
      .then((r) => ({ domain: r.domain, email: r.email }))
      .catch(() => null);
    altDomainMemo.set(key, p);
  }
  return p;
}

/** Verify one person, discovering the real email when we only have a guess. */
async function verifyOne(
  t: store.PersonVerifyTarget,
  opts: { skipLlm?: boolean } = {},
): Promise<VerifyOneResult> {
  if (t.emailKind === "found" && t.email) {
    const v = await cachedVerify(t.email);
    const ev: EmailVerification = { email: v.result.email, status: v.result.status, score: v.result.score, provider: v.provider, verifiedAt: v.result.verifiedAt };
    return { patch: { emailVerification: ev }, valid: v.result.status === "valid", found: false, provider: v.provider };
  }

  // Effective first/last for the pattern layers. Prefer the LinkedIn-slug-recovered
  // name (fuller); else the stored split; else derive it from `name` — so a row
  // that has a name + domain but NO first/last split (common in CSV imports) still
  // runs the cheap deterministic L1–L4 BEFORE the expensive Layer 5 is ever reached.
  const recovered = bestFullName(t.name, t.linkedin);
  const recoveredDiffers = normName(recovered) !== normName(t.name);
  let ef = t.firstName;
  let el = t.lastName;
  if (recoveredDiffers) { const s = splitFirstLast(recovered); if (s) { ef = s.first; el = s.last; } }
  else if (!ef || !el) { const s = splitFirstLast(recovered || t.name); if (s) { ef = s.first; el = s.last; } }

  // Pattern layers (L1–L4, public, L3) need a usable name split + a domain; Layer 5
  // (LLM) only needs a name + company (it discovers the domain), so it runs — LAST —
  // for domain-less / dead-MX rows and anything L1–L4 could not resolve.
  const canPattern = !!(ef && el && t.domain);
  const canLlm = !!(t.name && t.company);

  let companyEmail: string | undefined;
  let altName: string | undefined = recoveredDiffers ? recovered : undefined;
  let fallback: VerifyOneResult | null = null; // best not-found patch to persist if every layer misses
  const startedAt = Date.now();
  const overBudget = () => Date.now() - startedAt > ROW_BUDGET_MS; // anti-hang: skip slow SERP layers once past budget

  if (canPattern) {
    const nonWestern = detectProfile(t.country, recovered || t.name) !== "western";

    // SPEED + ACCURACY for non-Western names: verify the culture-aware candidates
    // FIRST, with early-exit. The real local-part follows the person's naming
    // system (Vietnamese `thild` = given+family-initial+middle-initial, CJK
    // family-first, …), so the accurate verifier confirms it in ~1 call — instead
    // of first sweeping the ~13 Western patterns that all miss (~13 SMTP round-
    // trips wasted, ~9s each). The culture ranking also covers the Western order
    // (given.family / family.given), so recall is preserved; the Western Layer 1
    // below still runs as a FALLBACK when the culture set doesn't confirm. The
    // verifier is untouched — only the ORDER we try candidates in changes.
    if (GLOBAL_PATTERN_LAYER && nonWestern) {
      const g = await findViaGlobalPatterns(t, uniqueDomains([t.domain]), recoveredDiffers ? recovered : undefined).catch(() => null);
      if (g) return { ...g, altName: g.altName ?? altName, companyEmail };
    }

    // Layer 1 — Western pattern finder on the website domain (primary for Western
    // names; fallback for a non-Western name the culture set didn't confirm).
    const outcome = await findPersonEmail({ firstName: ef, lastName: el, domain: t.domain! });
    const res = patchFromFinder(outcome);
    if (res.found) return { ...res, altName }; // confirmed mailbox → done
    if (outcome.state === "accept_all") return { ...overrideAcceptAllGuess(res, t, recoveredDiffers ? recovered : undefined), altName };
    fallback = res;

    // Layer 2 — alt-domain (company sends mail from a different domain). Needs a
    // company name to look up; skipped for a bare name+domain input (e.g. Finder).
    let altDomain: string | null = null;
    if (ALT_DOMAIN_LAYER && t.company && layerContinues(outcome.state)) {
      const alt = await altEmailDomainFor(t.company, t.location);
      companyEmail = !t.companyEmail && alt?.email ? alt.email : undefined;
      if (alt?.domain && cleanDomain(alt.domain) !== cleanDomain(t.domain!)) {
        altDomain = cleanDomain(alt.domain);
        const altOutcome = await findPersonEmail({ firstName: ef, lastName: el, domain: altDomain });
        if (altOutcome.state === "verified" || altOutcome.state === "accept_all") {
          return { ...patchFromFinder(altOutcome), altName, companyEmail };
        }
      }
    }

    // #3 — on a dead-MX (no_mx) website, drop the dead domain so Layer 4 doesn't
    // waste an SMTP mx-check on it; keep only the (live) alt-domain.
    const domains = uniqueDomains([t.domain, altDomain]);
    const liveDomains = outcome.state === "no_mx" ? uniqueDomains([altDomain]) : domains;

    // Layer 4 — culture-aware, FRONT-LOADED. Runs on the website + alt-domain.
    if (GLOBAL_PATTERN_LAYER && layerContinues(outcome.state) && liveDomains.length) {
      const g = await findViaGlobalPatterns(t, liveDomains).catch(() => null);
      if (g) return { ...g, altName: g.altName ?? altName, companyEmail };
    }

    // Public-sources: a DIFFERENT published address (personal/parent domain).
    // Company-scoped scrape, so skip it for a bare name+domain input. Skipped once
    // past the row budget (anti-hang).
    if (PUBLIC_SOURCES_LAYER && t.company && !overBudget() && layerContinues(outcome.state)) {
      const pub = await findViaPublicSources(t);
      if (pub) return { ...pub, altName, companyEmail };
    }

    // Layer 3 — reverse role→profile name-correction (crawler SERP). Skipped when
    // the slug already recovered a fuller name (P2), OR when the title is too
    // generic for a reliable reverse lookup (#4: "Product Owner" etc. → let Layer 5
    // correct the name instead of burning a SERP on namesakes).
    if (
      NAME_CORRECTION_LAYER && t.company && t.title && !recoveredDiffers && !overBudget() &&
      titleResolvableForReverseLookup(t.title) && layerContinues(outcome.state)
    ) {
      const corr = await findViaNameCorrection(t).catch(() => null);
      if (corr) {
        altName = corr.altName;
        if (corr.result) return { ...corr.result, altName, companyEmail: corr.result.companyEmail ?? companyEmail };
        if (GLOBAL_PATTERN_LAYER && liveDomains.length) {
          const g2 = await findViaGlobalPatterns(t, liveDomains, altName).catch(() => null);
          if (g2) return { ...g2, altName, companyEmail };
        }
      }
    }
  }

  // Layer 5 — terminal LLM (verify → discover domain → analyze). P1: runs for any
  // name+company row, INCLUDING one with no resolved domain or a dead-MX website —
  // exactly the rows whose real domain L5 is meant to discover (M&A / parent).
  if (canLlm) {
    if (opts.skipLlm) return { ...(fallback ?? notFoundPatch("reacher")), needsLlm: true, altName, companyEmail };
    // Knowledge-only first; escalate to web search only for a miss (demand-driven).
    const chosen = (await escalateL5([t], {
      idOf: (x) => x.personId,
      knowledge: (ts) => fillWithLlmStructure(ts, false),
      web: (ts) => fillWithLlmStructure(ts, true),
      escalate: L5_WEB_ESCALATE && (await l5WebSearchAvailable()), // #1: no wasted call when BE web is off
      cap: 1,
      notFound: () => notFoundPatch("reacher"),
    })).get(t.personId);
    if (chosen) return { ...chosen, altName: chosen.altName ?? altName, companyEmail: chosen.companyEmail ?? companyEmail };
  }

  if (fallback) return { ...fallback, altName, companyEmail };
  if (t.email) {
    const v = await cachedVerify(t.email);
    const ev: EmailVerification = { email: v.result.email, status: v.result.status, score: v.result.score, provider: v.provider, verifiedAt: v.result.verifiedAt };
    return { patch: { emailVerification: ev }, valid: v.result.status === "valid", found: false, provider: v.provider };
  }
  // No domain, no mailbox, or every layer empty — persist Not found.
  return notFoundPatch("reacher");
}

/* ------------------------- Finder-facing entry points -------------------- */
// The Email Finder (/finder) reuses the EXACT same layered pipeline as People —
// `verifyOne` does no store writes, so it is safe to call standalone. A bare
// name+domain input runs L1 (patterns) + L4 (culture-aware) only; supplying a
// company/title/linkedin/country unlocks L2/L3/public/L5 as well. This makes the
// finder culture-aware (Vietnamese/CJK/Malay/…) instead of Western-patterns-only.

export interface LayeredFinderInput {
  firstName: string;
  lastName: string;
  domain: string;
  name?: string;
  company?: string | null;
  title?: string | null;
  linkedin?: string | null;
  country?: string | null;
  location?: string | null;
}

function toLayeredTarget(input: LayeredFinderInput): store.PersonVerifyTarget {
  const name = (input.name || `${input.firstName} ${input.lastName}`).trim();
  return {
    personId: "finder",
    name,
    company: (input.company ?? "").trim(),
    firstName: input.firstName,
    lastName: input.lastName,
    domain: cleanDomain(input.domain) || null,
    location: input.location ?? input.country ?? null,
    country: input.country ?? input.location ?? null,
    email: null,
    emailKind: "none",
    title: input.title ?? null,
    linkedin: input.linkedin ?? null,
    companyEmail: null,
  };
}

function toFinderOutcome(res: VerifyOneResult, name: string, domain: string): FinderOutcome {
  const ev = res.patch.emailVerification;
  const email = res.patch.email ? String(res.patch.email.value) : ev?.email || (domain ? `@${domain}` : "");
  const rawStatus = ev?.status ?? "not_found";
  const state: FinderState = res.valid ? "verified" : res.patch.emailKind === "pattern" ? "accept_all" : "not_found";
  const status: FinderResult["status"] = rawStatus === "not_found" ? "unverified" : rawStatus;
  return {
    result: {
      id: "finder_best",
      email,
      score: ev?.score ?? 0,
      pattern: "",
      source: "layered finder",
      name: res.altName || name,
      domain,
      status,
      bestGuess: res.valid,
      state,
    },
    state,
    smtpCalls: 0,
    skipped: 0,
    provider: "reacher",
    fromCache: false,
  };
}

/** Find one email through the full layered pipeline (Finder single lookup). */
export async function findEmailLayered(input: LayeredFinderInput): Promise<FinderOutcome> {
  const target = toLayeredTarget(input);
  const domain = target.domain ?? cleanDomain(input.domain);
  let res: VerifyOneResult;
  try {
    res = await verifyOne(target);
  } catch (e) {
    if (e instanceof VerifierUnavailableError) throw e;
    res = notFoundPatch("reacher");
  }
  return toFinderOutcome(res, target.name, domain);
}

/** Bulk layered finder — bounded concurrency; same pipeline per row. */
export async function findManyEmailsLayered(
  people: LayeredFinderInput[],
  opts: { concurrency?: number } = {},
): Promise<BulkFinderResponse> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? CONCURRENCY, 64));
  const results: BulkFinderResult[] = new Array(people.length);
  const indexOf = new Map<LayeredFinderInput, number>(people.map((p, i) => [p, i]));

  const runPool = async (list: LayeredFinderInput[]) => {
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const p = list[next++];
        const outcome = await findEmailLayered(p);
        results[indexOf.get(p)!] = { input: { firstName: p.firstName, lastName: p.lastName, domain: p.domain }, outcome };
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, worker));
  };

  // Same domain-aware two-round scheduling as the People pass: learn each domain's
  // pattern from one probe (round 1), then the colleagues reuse it (round 2, ~1
  // SMTP). Big win for a CSV with many people at the same company.
  const { probes, rest } = partitionByDomain(
    people,
    (p) => cleanDomain(p.domain),
    (p) => (p.firstName && p.lastName ? 1 : 0),
  );
  await runPool(probes);
  await runPool(rest);

  const backendCalls = results.filter((r) => r.outcome.state === "verified").length;
  return { results, stats: { people: people.length, backendCalls, naiveCalls: people.length, saved: 0 } };
}

/**
 * Layer 5 (terminal, most important) — LLM "trust nothing: verify then analyze".
 * In ONE prompt the LLM (OpenAI when configured, else DeepSeek) first VERIFIES the
 * record — is this person really the holder of that title at that company (via the
 * LinkedIn URL), is the NAME complete/correct, is the DOMAIN right — and only then
 * analyses the (corrected) name's ethnic naming system to output email LOCAL-PARTS.
 * This stops a wrong name from poisoning the pattern analysis. We combine the
 * locals with the LLM-validated domain + known domains and SMTP-verify each — a
 * wrong guess is dropped, never shown. A corrected name is surfaced as `altName`
 * even when no mailbox resolves. Batched into one LLM call (token-efficient).
 */
// P2 — demand-driven web-search escalation. L5 runs knowledge-only first (cheap,
// ~1.3k tok); only rows it fails to resolve escalate to a web-search pass (~8k
// tok) that can discover a moved/parent domain (M&A). This beats guessing an "M&A
// signal" up front — that missed Camms, whose support email is still on the old
// domain. Global off-switch so the escalation pass is skipped entirely.
const L5_WEB_ESCALATE = (process.env.PEOPLE_VERIFY_L5_WEB ?? "1") !== "0";
// (a) cap the ~8k-token web-search pass per bulk run so a large not-found batch
// can't blow up cost; prioritized rows (M&A signal) fill the cap first.
const L5_WEB_MAX = Math.max(0, Number(process.env.PEOPLE_VERIFY_L5_WEB_MAX ?? 40));

async function fillWithLlmStructure(targets: store.PersonVerifyTarget[], webSearch: boolean): Promise<Map<string, VerifyOneResult>> {
  const out = new Map<string, VerifyOneResult>();
  if (targets.length === 0) return out;
  let resp: Awaited<ReturnType<typeof analyzeNameEmailStructureViaCrawler>>;
  try {
    resp = await analyzeNameEmailStructureViaCrawler(targets.map((t) => ({
      id: t.personId,
      name: bestFullName(t.name, t.linkedin),
      country: t.country,
      title: t.title,
      company: t.company,
      linkedin: t.linkedin,
      location: t.location,
      domain: t.domain,
      companyEmail: t.companyEmail,
    })), webSearch);
  } catch {
    return out;
  }
  if (!resp.configured) return out;

  const byId = new Map(targets.map((t) => [t.personId, t]));
  for (const r of resp.results) {
    const t = byId.get(r.id);
    if (!t) continue;
    // A name the LLM corrected is surfaced on the row (like Layer 3), even when
    // no mailbox resolves — so the record no longer shows a name we now doubt.
    // Prefer the LinkedIn-slug-recovered name for DISPLAY (it keeps the person's
    // own written order, e.g. slug chee-sang-ng → "Chee Sang Ng"); only fall back
    // to the LLM's correctName when the slug couldn't recover a fuller name (the
    // LLM tends to normalise CJK names to family-first "Ng Chee Sang").
    const slugName = bestFullName(t.name, t.linkedin);
    const corrected = normName(slugName) !== normName(t.name) ? slugName
      : (r.correctName && normName(r.correctName) !== normName(t.name)) ? r.correctName : undefined;
    const altName = corrected;
    // Verify against the LLM-validated domain(s) FIRST — the parent/acquirer domain
    // leads after an M&A (Camms → riskonnect.com) — then website + company-email.
    const domains = uniqueDomains([...(r.domains ?? []), r.domain, t.domain, domainOf(t.companyEmail)]).slice(0, 3);
    // Smart: combine the LLM's proposed locals with the FULL deterministic culture-
    // aware generator run on the (corrected) name — so the parent domain the LLM
    // discovered gets Layer-4's whole pattern breadth (initials, short forms, order
    // variants), covering cases the terse LLM list misses. LLM locals lead.
    const effName = (altName ?? t.name) || `${t.firstName} ${t.lastName}`;
    let locals = mergeLocals(r.locals, effName, { country: t.country, limit: 14 });
    // #2 — domain-less row: every domain here is web-GUESSED, so accept only
    // name-bearing locals (drop collision-prone initials/short truncations) to keep
    // precision on the softest subset. Rows WITH an input domain keep full breadth.
    if (!cleanDomain(t.domain ?? "")) locals = locals.filter(isDistinctiveLocal);
    let hit: VerifyOneResult | null = null;
    for (const dom of domains) {
      if (hit) break;
      for (const local of locals) {
        const email = `${local}@${dom}`;
        if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) continue;
        let v: Awaited<ReturnType<typeof cachedVerify>>;
        try {
          v = await cachedVerify(email);
        } catch {
          continue;
        }
        if (v.result.checks.mx === "fail") break; // this domain dead → next domain
        if (v.result.status === "valid") {
          hit = {
            patch: {
              email: { value: email, source: "llm", confidence: 80 },
              emailKind: "found",
              emailVerification: { email, status: "valid", score: v.result.score, provider: v.provider, verifiedAt: v.result.verifiedAt },
            },
            valid: true,
            found: true,
            provider: v.provider,
          };
          break;
        }
      }
    }
    out.set(r.id, { ...(hit ?? notFoundPatch("reacher")), altName });
  }
  return out;
}

export interface SinglePersonVerifyResult {
  ok: boolean;
  status: EmailVerification["status"] | null;
  email: string | null;
  found: boolean;
  valid: boolean;
  provider: "reacher" | "none";
}

/**
 * Per-row "Access email" — find + verify ONE person's email on demand and patch
 * that row. Same pipeline as the bulk pass, scoped to a single record.
 */
/** Fold the top-level companyEmail / altName (if discovered) into the patch. */
function patchToPersist(res: VerifyOneResult): PersonPatch {
  let patch = res.patch;
  if (res.companyEmail) patch = { ...patch, companyEmail: res.companyEmail };
  if (res.altName) patch = { ...patch, altName: res.altName };
  return patch;
}

function persistLookup(jobId: string, personId: string, res: VerifyOneResult): SinglePersonVerifyResult {
  store.updatePersonResolved(jobId, personId, patchToPersist(res));
  store.markPersonVerifying(jobId, personId, false);
  store.commitVerification(jobId);
  const ev = res.patch.emailVerification ?? null;
  return {
    ok: true,
    status: ev?.status ?? "not_found",
    email: res.patch.email ? String(res.patch.email.value) : (ev?.email || null),
    found: res.found,
    valid: res.valid,
    provider: res.provider,
  };
}

export async function verifyOnePersonEmail(jobId: string, personId: string): Promise<SinglePersonVerifyResult> {
  store.markPersonVerifying(jobId, personId, true);
  try {
    const target = store.personVerifyTarget(jobId, personId);
    if (!target) {
      const res = notFoundPatch("reacher");
      store.updatePersonResolved(jobId, personId, res.patch);
      store.commitVerification(jobId);
      return { ok: true, status: "not_found", email: null, found: false, valid: false, provider: "none" };
    }
    let res: VerifyOneResult | null = null;
    try {
      res = await verifyOne(target);
    } catch (e) {
      // The verification engine being unreachable is a real error, never a
      // "not found" — surface it so the UI can tell the user to retry.
      if (e instanceof VerifierUnavailableError) throw e;
      res = null;
    }
    return persistLookup(jobId, personId, res ?? notFoundPatch("reacher"));
  } finally {
    store.markPersonVerifying(jobId, personId, false);
  }
}

export async function verifyCollectedPeople(jobId: string, onlyUnverified = true): Promise<VerifyPassResult> {
  const targets = store.peopleVerifyTargets(jobId, onlyUnverified);
  if (targets.length === 0) {
    store.setJobVerifyStatus(jobId, "done");
    return { verified: 0, valid: 0, found: 0, provider: "none" };
  }

  store.setJobVerifyStatus(jobId, "verifying");

  let verified = 0;
  let valid = 0;
  let found = 0;
  let sinceCommit = 0;
  const providers = new Set<"reacher">();
  const pendingLlm: store.PersonVerifyTarget[] = [];
  // companyEmail / altName discovered before a row deferred to LLM — re-applied after.
  const deferredCompanyEmail = new Map<string, string>();
  const deferredAltName = new Map<string, string>();

  const apply = (t: store.PersonVerifyTarget, res: VerifyOneResult) => {
    store.updatePersonResolved(jobId, t.personId, patchToPersist(res));
    store.markPersonVerifying(jobId, t.personId, false);
    providers.add(res.provider);
    verified++;
    if (res.valid) valid++;
    if (res.found) found++;
    if (++sinceCommit >= COMMIT_EVERY) { sinceCommit = 0; store.commitVerification(jobId); }
  };

  const handleRow = async (t: store.PersonVerifyTarget) => {
    store.markPersonVerifying(jobId, t.personId, true);
    try {
      let res: VerifyOneResult | null = null;
      try {
        res = await verifyOne(t, { skipLlm: true });
      } catch (e) {
        // Engine unreachable → abort the whole pass with a real error rather
        // than silently marking everyone "not found".
        if (e instanceof VerifierUnavailableError) throw e;
        res = null;
      }
      if (!res) apply(t, notFoundPatch("reacher"));
      else if (res.needsLlm) {
        if (res.companyEmail) deferredCompanyEmail.set(t.personId, res.companyEmail);
        if (res.altName) deferredAltName.set(t.personId, res.altName);
        pendingLlm.push(t);
      } else apply(t, res);
    } finally {
      store.markPersonVerifying(jobId, t.personId, false);
    }
  };

  /** Run `list` through `handleRow` with a bounded worker pool. */
  const runPool = async (list: store.PersonVerifyTarget[], conc: number) => {
    let next = 0;
    const worker = async () => { while (next < list.length) await handleRow(list[next++]); };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(conc, list.length)) }, worker));
  };

  // Domain-aware two-round scheduling (perf): the finder LEARNS a domain's winning
  // pattern (+ no-MX fact) from the first person it resolves there; every later
  // person at that domain then verifies the learned format FIRST → ~1 SMTP instead
  // of the full candidate sweep. Running all colleagues in parallel up front wastes
  // that — they'd all full-sweep before anyone learns. So:
  //   Round 1 — ONE probe per domain (learns the pattern).
  //   Round 2 — everyone else (reuses the learned pattern; mostly 1 SMTP).
  // This ONLY reorders work; each row still runs the identical pipeline + SMTP
  // verification, so accuracy is unchanged — it just removes redundant SMTP calls.
  // Probe with the row most likely to LEARN the domain's pattern: a clean
  // first+last that isn't an already-scraped ("found") email.
  const { probes, rest } = partitionByDomain(
    targets,
    (t) => cleanDomain(t.domain ?? ""),
    (t) => (t.firstName && t.lastName ? 2 : 0) + (t.emailKind !== "found" ? 1 : 0),
  );

  try {
    await runPool(probes, CONCURRENCY); // learn one pattern per domain
    await runPool(rest, CONCURRENCY); // fast fill — reuses learned patterns

    if (pendingLlm.length > 0) {
      store.setVerifyingPersonIds(jobId, pendingLlm.map((t) => t.personId));
      // P2 — knowledge-only for everyone; escalate ONLY the unresolved rows (capped
      // + prioritized) to a web-search pass that discovers moved/parent domains
      // (Camms → riskonnect.com). Cheap for the common case, correct for the M&A tail.
      const webOk = L5_WEB_ESCALATE && (await l5WebSearchAvailable()); // #1: gate on real BE capability
      const llmHits = await escalateL5(pendingLlm, {
        idOf: (x) => x.personId,
        knowledge: (ts) => fillWithLlmStructure(ts, false),
        web: (ts) => fillWithLlmStructure(ts, true),
        escalate: webOk,
        cap: L5_WEB_MAX,
        notFound: () => notFoundPatch("reacher"),
      });
      for (const t of pendingLlm) {
        const r = llmHits.get(t.personId) ?? notFoundPatch("reacher");
        const ce = deferredCompanyEmail.get(t.personId);
        const an = deferredAltName.get(t.personId);
        apply(t, {
          ...r,
          companyEmail: r.companyEmail ?? ce,
          altName: r.altName ?? an,
        });
      }
    }
  } catch (e) {
    if (e instanceof VerifierUnavailableError) {
      // Don't mark the pass "done" — persist whatever was verified and reset to
      // idle so it can be retried, then surface the error to the route.
      store.setVerifyingPersonIds(jobId, []);
      store.commitVerification(jobId);
      store.setJobVerifyStatus(jobId, "idle");
    }
    throw e;
  }

  store.setVerifyingPersonIds(jobId, []);
  store.commitVerification(jobId);
  store.setJobVerifyStatus(jobId, "done");
  store.sealMissedEmailLookups(jobId);
  const provider: "reacher" | "none" = providers.has("reacher") ? "reacher" : "none";
  return { verified, valid, found, provider };
}

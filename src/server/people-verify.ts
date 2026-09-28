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
import { AsyncResource } from "node:async_hooks";
import { cachedVerify } from "./verification";
import { VerifierUnavailableError } from "@/lib/verifier/backend";
import { m365MailboxExists } from "@/lib/verifier/m365";
import { findPersonEmail, cachedDomainClass, classifyDomain, isM365VerifiedDomain, knownDomainPattern, seedDomainPattern, setGlobalFallbackPattern, bestGuessEmail } from "./finder";
import { cleanDomain, derivePatternId } from "@/lib/finder/patterns";
import { companyDomainVariants, strongVariantMatch, variantPageRelevant } from "@/lib/finder/domain-variants";
import { extractSiteMailDomains } from "@/lib/finder/site-mail-domains";
import { resolveMx } from "node:dns/promises";
import { bestFullName, detectProfile, generateGlobalCandidates, learnGlobalPattern, learnedGlobalPattern, mergeLocals, splitFirstLast } from "@/lib/finder/global-name-patterns";
import { companyMailDomainHint, emailFormatTemplate, escalateL5, isDistinctiveLocal, layerContinues, partitionByDomain, sameCompanyDomain, scrapedEmailTrusted, titleResolvableForReverseLookup, verifyRanked } from "@/lib/finder/verify-orchestration";
import { analyzeNameEmailStructureViaCrawler, l5WebSearchAvailable, resolveCompanyEmailDomainViaCrawler, withCrawlerRecord, resolvePersonEmailsViaCrawler, resolvePersonByRoleViaCrawler, resolveNameByLinkedinUrlViaCrawler } from "./crawler-client";
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

/**
 * A backend `valid` we can TRUST as a real per-mailbox confirmation. On a catch-all
 * domain, `valid` (reacher "safe") is trustworthy ONLY with a per-address observation;
 * a "dumb" catch-all marks every address deliverable, so a `valid` there without one is
 * a false positive. Mirrors the finder's guard so every layer applies it consistently.
 */
/** Reacher score floor for a `valid` to count: below it the row is Not found (user rule). */
const MIN_VALID_SCORE = Number(process.env.FINDER_MIN_VALID_SCORE ?? 60);
function trustedValid(r: { status: string; score: number; checks: { catchAll: boolean }; perAddressObservation?: boolean }): boolean {
  return r.status === "valid" && r.score >= MIN_VALID_SCORE && (!r.checks.catchAll || r.perAddressObservation === true);
}

/**
 * LAST-RESORT best-guess result, used ONLY after every discovery layer has missed. On a
 * live (non-dead) domain SMTP couldn't verify, surface the domain's learned convention
 * (high confidence) or the global-prior pattern (low confidence) as a clearly-marked
 * catch_all guess — emailKind "pattern", never "valid"/"found" — so a reachable row has
 * a likely address instead of a bare Not found. Returns null when best-guessing is off,
 * the domain is dead, or no pattern applies. NEVER call before the discovery layers.
 */
async function bestGuessResult(domain: string | null, first: string, last: string): Promise<VerifyOneResult | null> {
  const dom = cleanDomain(domain ?? "");
  if (!dom) return null;
  // Best-guess ONLY on domains SMTP could NOT verify (catch-all / opaque). On an "ok"
  // (discriminating) domain the standard patterns were actually tested — if none passed,
  // the real address is non-standard (a nickname) and guessing a pattern would emit an
  // address SMTP already proved invalid. On "dead" there's no mailbox at all.
  const cls = cachedDomainClass(dom);
  if (cls !== "catchall" && cls !== "opaque") return null;
  const bg = bestGuessEmail(dom, first, last);
  if (!bg) return null;
  // The shown status/score is what reacher ACTUALLY returned for this exact address
  // (per-email cached, so usually free) — never a hard-coded "catch_all".
  const v = await reacherVerdict(bg.email);
  return {
    patch: {
      email: { value: bg.email, source: "other", confidence: bg.confidence },
      emailKind: v.valid ? "found" : "pattern",
      emailVerification: v.ev,
    },
    valid: v.valid,
    found: v.valid,
    provider: "reacher",
  };
}

/**
 * Reacher's real verdict for one address, as stored on the row. A `valid` that is NOT
 * trustworthy (catch-all server, no per-address observation — a bogus address on the
 * same domain gets the identical `valid`) is stored as reacher's own catch-all flag,
 * with reacher's score. An engine error settles as an honest `unknown`.
 */
async function reacherVerdict(email: string): Promise<{ ev: EmailVerification; valid: boolean }> {
  try {
    const v = await cachedVerify(email);
    const r = v.result;
    const valid = trustedValid(r);
    const status = r.status === "valid" && !valid ? "catch_all" : r.status;
    return { ev: { email, status, score: r.score, provider: v.provider, verifiedAt: r.verifiedAt }, valid };
  } catch {
    return { ev: { email, status: "unknown", score: 0, provider: "reacher", verifiedAt: now() }, valid: false };
  }
}

/**
 * Learn every domain's email convention from the confirmed emails already in the store
 * and hand them to the finder (seedDomainPattern). One verified colleague teaches the
 * whole company's pattern, so the not-found colleagues on catch-all / opaque domains —
 * which SMTP cannot verify — resolve to the company's proven format. Weight = number of
 * corroborating colleagues, so the dominant convention wins on any disagreement.
 */
function seedDomainPatternsFromStore(): { domains: number; signals: number; globalPattern: string | null } {
  const signals = store.knownEmailSignals();
  // domain → patternId → count, plus a global tally for the fallback prior.
  const tally = new Map<string, Map<string, number>>();
  const globalTally = new Map<string, number>();
  for (const s of signals) {
    const pid = derivePatternId(s.local, s.firstName, s.lastName);
    if (!pid) continue;
    globalTally.set(pid, (globalTally.get(pid) ?? 0) + 1);
    const dom = cleanDomain(s.domain);
    if (!dom) continue;
    let m = tally.get(dom);
    if (!m) { m = new Map(); tally.set(dom, m); }
    m.set(pid, (m.get(pid) ?? 0) + 1);
  }
  let domains = 0;
  for (const [dom, m] of tally) {
    // Pick the most-corroborated pattern for the domain; seed it with its colleague count.
    const [pid, weight] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    seedDomainPattern(dom, pid, weight);
    domains++;
  }
  // Global-dominant pattern (data-driven, e.g. "first") for the last-resort weak guess.
  const globalPattern = [...globalTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  setGlobalFallbackPattern(globalPattern);
  return { domains, signals: signals.length, globalPattern };
}

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
      // Bind to the ENQUEUER's async context: pump() may start this job from another
      // row's `finally`, and the crawler call must still carry THIS row's record id.
      queue.push(AsyncResource.bind(() => {
        fn().then(resolve, reject).finally(() => { active--; pump(); });
      }));
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
    // Reacher's status for this address as-is. Not verified → "unknown" (not a made-up
    // catch_all); a `valid` here was NOT trusted by the finder → reacher's catch-all flag.
    const status = r.status === "unverified" ? "unknown" : r.status === "valid" ? "catch_all" : r.status;
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

// Layer 3a — DIRECT name recovery from the person's OWN LinkedIn URL. When the
// stored name is incomplete and the vanity slug is ABBREVIATED (slug `gohew`,
// stored "Goh Wei", real "Goh Eng Wei"), bestFullName can't expand it, but the
// profile's DISPLAY title can — so the culture-aware finder builds the right
// local-part (gohengwei@…). On by default; set to "0" to disable.
const LINKEDIN_NAME_LAYER = (process.env.PEOPLE_VERIFY_LINKEDIN_NAME ?? "1") !== "0";

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
const ROW_BUDGET_MS = Math.max(5_000, Number(process.env.PEOPLE_VERIFY_ROW_BUDGET_MS ?? 60_000));

// HARD per-row deadline (backstop, no-hang guarantee): no single row may occupy a
// worker longer than this regardless of how slow any downstream call is. On expiry
// the row is settled Not-found and the worker moves on. verifyOne keeps its own
// per-layer timeouts; this only catches a pathological combination. Must exceed the
// slowest single layer (reacher 25s, crawler SERP 20s) so it never cuts a healthy row.
const ROW_HARD_MS = Math.max(20_000, Number(process.env.PEOPLE_VERIFY_ROW_HARD_MS ?? 150_000));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  // Best source-backed address the server couldn't confirm (catch-all/greylist) —
  // surfaced only if no address SMTP-confirms `valid`. The crawler already vetted a
  // cross-domain hit by requiring the source PAGE to name the person, so a published
  // address on a catch-all domain (jack@vaudit.com after a job change) is still shown.
  let fallbackUnconfirmed: VerifyOneResult | null = null;
  for (const email of emails) {
    // On the company's OWN domain, or a free-mail personal address with a full
    // first+last match → high trust. A cross-domain corporate address is trusted
    // because the crawler only returns one when its source page NAMED the person.
    const onDomainOrFree = scrapedEmailTrusted(email, t.domain, t.firstName, t.lastName);
    let v: Awaited<ReturnType<typeof cachedVerify>>;
    try {
      v = await cachedVerify(email);
    } catch {
      continue;
    }
    if (v.result.checks.mx === "fail") continue; // dead domain → not this person's mailbox
    if (trustedValid(v.result)) {
      return {
        patch: {
          email: { value: email, source: onDomainOrFree ? "website" : "other", confidence: onDomainOrFree ? 88 : 82 },
          emailKind: "found",
          emailVerification: { email, status: "valid", score: v.result.score, provider: v.provider, verifiedAt: now() },
        },
        valid: true,
        found: true,
        provider: v.provider,
      };
    }
    // Real published address the server can't confirm/deny (catch-all/greylist/
    // unknown). Keep the best one (results are score-sorted, best first) as a
    // source-backed fallback rather than dropping it to a false Not-found — BUT only
    // when it is tied to THIS person, never a bare company mailbox that could be a
    // colleague's: either the local part carries the name, OR it is cross-domain (which
    // the crawler only returns after its source page named the person). On a catch-all
    // company domain a name-less on-domain address (jack@ for a non-Jack colleague) is
    // NOT surfaced — that would mis-assign a coworker's email.
    const emLocal = (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const emDom = email.split("@")[1] ?? "";
    const f = (t.firstName ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const l = (t.lastName ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const nameTied = (f.length >= 2 && emLocal.includes(f)) || (l.length >= 3 && emLocal.includes(l));
    const crossDomain = !!t.domain && !sameCompanyDomain(emDom, t.domain);
    if (!fallbackUnconfirmed && v.result.status !== "invalid" && (nameTied || crossDomain)) {
      const status = v.result.status === "unknown" ? "risky" : v.result.status;
      fallbackUnconfirmed = {
        patch: {
          email: { value: email, source: onDomainOrFree ? "website" : "other", confidence: onDomainOrFree ? 74 : 68 },
          emailKind: "found",
          emailVerification: { email, status, score: v.result.score || 55, provider: v.provider, verifiedAt: now() },
        },
        valid: false,
        found: true,
        provider: v.provider,
      };
    }
  }
  return fallbackUnconfirmed;
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
 * Name-recovery (3a) layer. Read the person's DISPLAY name straight off their OWN
 * LinkedIn profile URL (slug-targeted SERP) when the stored name is incomplete and
 * the vanity slug is ABBREVIATED (slug `gohew`, stored "Goh Wei", real "Goh Eng
 * Wei") — the one case `bestFullName` can't recover from the slug alone. Returns
 * the fuller name (gated to a ≥1-token overlap with the stored name, so it only
 * ever extends/fixes a name, never swaps in a wholesale-different person), or null.
 * The caller feeds it into Layer 4 so the culture-aware generator builds the right
 * local-part ("Goh Eng Wei" → gohengwei@). Kept lean (name only, no email attempts)
 * so it fits inside the row budget even when SERP is slow.
 */
async function findViaLinkedinName(t: store.PersonVerifyTarget): Promise<string | null> {
  if (!t.linkedin) return null;
  const linkedin = t.linkedin; // capture narrowed value
  let corr: Awaited<ReturnType<typeof resolveNameByLinkedinUrlViaCrawler>>;
  try {
    corr = await serpLimit(() => resolveNameByLinkedinUrlViaCrawler({ linkedin, knownName: t.name, company: t.company, location: t.location }));
  } catch {
    return null;
  }
  if (!corr.matched || !corr.changed || !corr.firstName || !corr.lastName) return null;
  const altName = (corr.name ?? `${corr.firstName} ${corr.lastName}`).trim();
  const stored = nameTokens(t.name);
  if (![...nameTokens(altName)].some((tok) => stored.has(tok))) return null;
  return altName;
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
    // Classify first (cached; the same one probe Layer 1 would pay) so a Microsoft 365
    // tenant is known BEFORE the sweep — there SMTP is refused per address, and a
    // 20-candidate SMTP sweep blew the per-row deadline (benwong@riverchain.com was
    // missed in the bulk pass but found alone). Dead/opaque/catch-all → next domain.
    if ((await classifyDomain(domain).catch(() => ({ klass: "ok" as const }))).klass !== "ok") continue;
    const learned = learnedGlobalPattern(domain);
    const candidates = generateGlobalCandidates(rawName, {
      country: t.country, domain, learnedPatternId: learned, limit: GLOBAL_PATTERN_MAX,
    });
    if (candidates.length === 0) continue;
    if (isM365VerifiedDomain(domain)) {
      // Microsoft answers per account over HTTPS (~0.3s); a hit is then recorded
      // through cachedVerify so the stored verdict is the verifier's own.
      for (const c of candidates) {
        if ((await m365MailboxExists(c.email).catch(() => "inconclusive")) !== "exists") continue;
        const v = await cachedVerify(c.email).catch(() => null);
        if (!v || !trustedValid(v.result)) continue;
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
      continue;
    }
    // Ranked-parallel verify: candidate[0] (learned pattern) alone first, the rest
    // in parallel — same winner as sequential, just faster. mxFail → next domain.
    const { winner, mxFail } = await verifyRanked(
      candidates,
      (email) => cachedVerify(email),
      (v) => trustedValid(v.result),
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
        if (!confirm || !trustedValid(confirm.result)) continue; // sweep artifact / dumb catch-all → next domain
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
async function overrideAcceptAllGuess(res: VerifyOneResult, t: store.PersonVerifyTarget, effectiveName?: string): Promise<VerifyOneResult> {
  if (!GLOBAL_PATTERN_LAYER || !t.domain || !res.patch.email) return res;
  // Use the SAME name Layer 1 searched (slug-recovered when fuller), so the shown
  // catch-all guess stays consistent with the address we actually tried.
  const rawName = (effectiveName || t.name || `${t.firstName} ${t.lastName}`).trim();
  if (!rawName || detectProfile(t.country, rawName) === "western") return res;
  const top = generateGlobalCandidates(rawName, { country: t.country, domain: t.domain, limit: 1 })[0];
  if (!top?.email) return res;
  const currentLocal = String(res.patch.email.value).split("@")[0];
  if (top.local === currentLocal) return res;
  // A different address → it needs ITS OWN reacher verdict, not the replaced one's.
  const v = await reacherVerdict(top.email);
  return {
    ...res,
    patch: {
      ...res.patch,
      email: { ...res.patch.email, value: top.email },
      emailKind: v.valid ? "found" : "pattern",
      emailVerification: v.ev,
    },
    valid: v.valid,
    found: v.valid,
  };
}

/**
 * Discover the domain a company actually sends mail from AND the published
 * support/contact email it was derived from (Decodo "email support <company>"),
 * memoized per company+location so everyone at one company costs at most ONE SERP
 * lookup. Failures memoize as null. Returns null on any error.
 */
type AltEmailHit = { domain: string | null; email: string | null; domains: string[] };
const altDomainMemo = new Map<string, Promise<AltEmailHit | null>>();
function altEmailDomainFor(company: string, location: string | null, website: string | null): Promise<AltEmailHit | null> {
  // Website is part of the key: the crawler returns the best mail domain that
  // DIFFERS from it (its SERP evidence is cached per company, so this adds no SERP).
  const site = cleanDomain(website ?? "");
  const key = `${company.toLowerCase().trim()}|${(location ?? "").toLowerCase().trim()}|${site}`;
  let p = altDomainMemo.get(key);
  if (!p) {
    if (altDomainMemo.size > 1000) altDomainMemo.clear();
    p = serpLimit(() => resolveCompanyEmailDomainViaCrawler(company, location ?? "", site || null))
      .then((r) => ({ domain: r.domain, email: r.email, domains: r.domains?.length ? r.domains : r.domain ? [r.domain] : [] }))
      .catch(() => null);
    altDomainMemo.set(key, p);
    // Don't pin a miss for the whole process (engines may just be rate-limited now):
    // an empty/failed lookup is dropped so the next row of the company retries it.
    void p.then((hit) => { if (!hit || !hit.domains.length) altDomainMemo.delete(key); });
  }
  return p;
}

/* --------------------- L2.5 — sibling / variant domains ------------------ */
// The company's employee-mail domain is often a SIBLING of the website domain:
// the site is the short brand (`risingwave.com`) but mail is on the legal-entity
// domain (`risingwave-labs.com`), a joined form (`risingwavelabs.com`) or a
// different TLD (`risingwave.io`). L2's support-email lookup returns the WEBSITE
// domain (contact@risingwave.com), which is discarded as "same as website", so the
// sibling is never tried. Here we generate those candidates DETERMINISTICALLY,
// MX-gate them (cheap DNS — no SERP/SMTP/LLM), and hand the LIVE ones to the SAME
// verify layers (L4/L5). Precision is unchanged: only a per-address SMTP-confirmed
// `valid` is ever surfaced, so a live-but-wrong sibling can't fabricate an email.
const VARIANT_DOMAIN_LAYER = (process.env.PEOPLE_VERIFY_VARIANT_DOMAINS ?? "1") !== "0";
const VARIANT_MX_TIMEOUT_MS = Math.max(1_000, Number(process.env.PEOPLE_VERIFY_VARIANT_MX_TIMEOUT_MS ?? 3_000));

// Per-domain MX result cache (process-lifetime): a bulk pass probes the same handful
// of variant domains for every colleague at a company, so cache the DNS answer.
const mxLiveCache = new Map<string, Promise<boolean>>();
function hasLiveMx(domain: string): Promise<boolean> {
  const d = cleanDomain(domain);
  let p = mxLiveCache.get(d);
  if (!p) {
    if (mxLiveCache.size > 5000) mxLiveCache.clear();
    p = Promise.race([
      resolveMx(d).then((recs) => Array.isArray(recs) && recs.length > 0).catch(() => false),
      sleep(VARIANT_MX_TIMEOUT_MS).then(() => false),
    ]);
    mxLiveCache.set(d, p);
  }
  return p;
}

// Memoized per company+website: the LIVE sibling domains for a company. Everyone at
// one company shares the (bounded) DNS work, so a big bulk pass costs one MX sweep
// per company, not per row.
const variantDomainsMemo = new Map<string, Promise<string[]>>();
// Live variants handed to Layer 4, best-first: each costs a per-domain SMTP sweep.
const VARIANT_MAX_LIVE = Math.max(1, Number(process.env.PEOPLE_VERIFY_VARIANT_MAX_LIVE ?? 4));
function liveVariantDomainsFor(
  website: string | null,
  company: string,
  opts: { country?: string | null; companyLinkedin?: string | null } = {},
): Promise<string[]> {
  if (!VARIANT_DOMAIN_LAYER) return Promise.resolve([]);
  const site = cleanDomain(website ?? "");
  const key = `${site}|${company.toLowerCase().trim()}|${opts.country ?? ""}|${opts.companyLinkedin ?? ""}`;
  let p = variantDomainsMemo.get(key);
  if (!p) {
    if (variantDomainsMemo.size > 2000) variantDomainsMemo.clear();
    const cands = companyDomainVariants(site, company, 40, opts);
    // DNS MX lookups are cheap (non-existent domains reject in ~ms; each capped at
    // VARIANT_MX_TIMEOUT_MS). Run ALL in parallel — measured ~1s for 18 vs ~2.75s
    // when batched — so the (memoized, once-per-company) probe never stalls a row.
    p = (async () => {
      const oks = await Promise.all(cands.map(async (d) => ((await hasLiveMx(d).catch(() => false)) ? d : null)));
      const live = oks.filter((d): d is string => d !== null);
      // Relevance gate (precision): a structural match (strongVariantMatch) is kept; any other
      // live variant must have a homepage that names this company, else it is a
      // different business on a generic root (cricket.com, two.com, west.com).
      const checks = await Promise.all(
        live.slice(0, VARIANT_MAX_LIVE * 3).map(async (d) => {
          if (strongVariantMatch(d, { websiteDomain: site, companyName: company, companyLinkedin: opts.companyLinkedin })) return d;
          const page = (await fetchPage(`https://${d}`)) ?? (await fetchPage(`http://${d}`));
          return page && variantPageRelevant(page.html, { websiteDomain: site, companyName: company, country: opts.country, variant: d }) ? d : null;
        }),
      );
      return checks.filter((d): d is string => d !== null).slice(0, VARIANT_MAX_LIVE);
    })();
    variantDomainsMemo.set(key, p);
  }
  return p;
}

/* ------------- L2c — mail domains published on the company website ------------- */
// A website with NO MX (apollo_people (17): 61 rows, 95% Not found) usually means
// the company mails from another domain, and its homepage says which one — a redirect
// (gobi-gba.vc → gobi.vc) or a printed address (y-intercept.org → info@y-intercept.net).
// One homepage fetch per company (memoized), then MX-gated like the variants.
const SITE_MAIL_LAYER = (process.env.PEOPLE_VERIFY_SITE_MAIL_DOMAINS ?? "1") !== "0";
const SITE_FETCH_TIMEOUT_MS = Math.max(2_000, Number(process.env.PEOPLE_VERIFY_SITE_FETCH_TIMEOUT_MS ?? 8_000));
const SITE_MAX_BYTES = 600_000;

async function fetchPage(url: string): Promise<{ html: string; finalHost: string | null } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SITE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MSN-Enrich/1.0)", Accept: "text/html,*/*" },
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < SITE_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.length;
    }
    reader.cancel().catch(() => {});
    const html = Buffer.concat(chunks).toString("utf8");
    let finalHost: string | null = null;
    try { finalHost = new URL(res.url).hostname; } catch { /* keep null */ }
    return { html, finalHost };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const siteMailMemo = new Map<string, Promise<string[]>>();
function liveSiteMailDomainsFor(website: string | null): Promise<string[]> {
  const site = cleanDomain(website ?? "");
  if (!SITE_MAIL_LAYER || !site) return Promise.resolve([]);
  let p = siteMailMemo.get(site);
  if (!p) {
    if (siteMailMemo.size > 2000) siteMailMemo.clear();
    p = (async () => {
      let found: string[] = [];
      for (const url of [`https://${site}`, `http://${site}`, `https://www.${site}`]) {
        const page = await fetchPage(url);
        if (!page) continue;
        found = extractSiteMailDomains(page.html, site, page.finalHost);
        // Nothing on the homepage → the contact page is where companies print it.
        if (!found.length) {
          const base = page.finalHost ? `https://${page.finalHost}` : url;
          for (const path of ["/contact", "/contact-us"]) {
            const c = await fetchPage(base + path);
            if (c) found = extractSiteMailDomains(c.html, site, null);
            if (found.length) break;
          }
        }
        break;
      }
      const live = await Promise.all(found.map(async (d) => ((await hasLiveMx(d).catch(() => false)) ? d : null)));
      return live.filter((d): d is string => d !== null);
    })().catch(() => []);
    siteMailMemo.set(site, p);
  }
  return p;
}

/**
 * Best guess that prefers the company's REAL mail domain (Layer 2 alt-domain, e.g.
 * s2ceda.com) over the website domain (s2cinc.com) when they differ. The alt lookup
 * is memoized per company, so this costs no extra SERP after Layer 2 has run.
 */
async function bestGuessPreferMailDomain(
  t: Pick<store.PersonVerifyTarget, "company" | "location" | "domain">,
  first: string,
  last: string,
): Promise<VerifyOneResult | null> {
  if (ALT_DOMAIN_LAYER && t.company) {
    const alt = await altEmailDomainFor(t.company, t.location, t.domain);
    const altDom = alt?.domain ? cleanDomain(alt.domain) : "";
    if (altDom && altDom !== cleanDomain(t.domain ?? "")) {
      const bg = await bestGuessResult(altDom, first, last);
      if (bg) return bg;
    }
  }
  return bestGuessResult(t.domain, first, last);
}

/**
 * Verify one person, discovering the real email when we only have a guess. Every
 * crawler call made for this row carries its id, so the crawler caps the row's PAID
 * Decodo requests (max 3 per record by default).
 */
function verifyOne(t: store.PersonVerifyTarget, opts: { skipLlm?: boolean } = {}): Promise<VerifyOneResult> {
  return withCrawlerRecord(t.personId, () => verifyOneInner(t, opts));
}

async function verifyOneInner(
  t: store.PersonVerifyTarget,
  opts: { skipLlm?: boolean } = {},
): Promise<VerifyOneResult> {
  if (t.emailKind === "found" && t.email) {
    const v = await cachedVerify(t.email);
    const ev: EmailVerification = { email: v.result.email, status: v.result.status, score: v.result.score, provider: v.provider, verifiedAt: v.result.verifiedAt };
    return { patch: { emailVerification: ev }, valid: trustedValid(v.result), found: false, provider: v.provider };
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

    // The row's company email is evidence of the company's MAIL setup:
    //  • a vendor format template (Apollo's "jsmith@chelsfield.com") names the
    //    convention → seed it so that pattern is verified FIRST on its domain (only
    //    when no colleague-proven convention exists — real evidence outranks a template);
    //  • its domain, when it differs from the website, is a candidate MAIL domain
    //    (y-intercept.org site / y-intercept.net mail). Still verified like any other.
    const tmpl = emailFormatTemplate(t.companyEmail);
    if (tmpl && !knownDomainPattern(tmpl.domain)) seedDomainPattern(tmpl.domain, tmpl.patternId, 1);
    const hintDomain = companyMailDomainHint(t.companyEmail, t.domain);

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
      if (g?.valid) return { ...g, altName: g.altName ?? altName, companyEmail };
    }

    // Layer 1 — Western pattern finder on the website domain (primary for Western
    // names; fallback for a non-Western name the culture set didn't confirm).
    const outcome = await findPersonEmail({ firstName: ef, lastName: el, domain: t.domain! });
    const res = patchFromFinder(outcome);
    if (res.found) return { ...res, altName }; // confirmed mailbox → done
    fallback = outcome.state === "accept_all" ? await overrideAcceptAllGuess(res, t, recoveredDiffers ? recovered : undefined) : res;

    // Layer 2 — company contact → alt-domain (company sends mail from a different
    // domain than its website, e.g. s2cinc.com → sales@s2ceda.com). Runs for EVERY
    // unconfirmed outcome — including catch-all / opaque websites, which are exactly
    // where a mismatched mail domain hides — and BEFORE the bulk fast path, so the
    // company email is always captured. Memoized per company+location → at most ONE
    // SERP per company even on a 6000-row pass. Skipped for a bare name+domain input.
    let altDomain: string | null = null;
    const extraAltDomains: string[] = [];
    if (ALT_DOMAIN_LAYER && t.company) {
      const alt = await altEmailDomainFor(t.company, t.location, t.domain);
      if (!t.companyEmail && alt?.email) companyEmail = alt.email;
      // EVERY plausible non-website mail domain (≤3, best first) — a group can mail
      // from several: Wada FoodTech sells from wadafoodtech.jp while staff use
      // wadabento.com (stephenchan@). Each is pattern-verified; first confirmed wins.
      for (const raw of alt?.domains ?? []) {
        const dom = cleanDomain(raw);
        if (!dom || dom === cleanDomain(t.domain!) || extraAltDomains.includes(dom)) continue;
        extraAltDomains.push(dom);
        const altOutcome = await findPersonEmail({ firstName: ef, lastName: el, domain: dom });
        if (altOutcome.state === "verified") return { ...patchFromFinder(altOutcome), altName, companyEmail };
        if (!altDomain) {
          altDomain = dom; // the best one drives the (legacy) guess/fallback below
          // The mail domain differs from the website: a guess on the REAL mail domain
          // beats a guess on the website domain (which may not even receive mail).
          if (altOutcome.state === "accept_all") fallback = patchFromFinder(altOutcome);
          else if (outcome.state === "accept_all") fallback = (await bestGuessResult(dom, ef, el)) ?? fallback; // opaque mail domain
        }
      }
    }
    // Layer 2b — the company-email domain hint (see above), when it is neither the
    // website nor the SERP alt-domain. Verified patterns only; no guess from it.
    const hintLive = hintDomain && !extraAltDomains.includes(hintDomain) ? hintDomain : null;
    if (hintLive) {
      const hintOutcome = await findPersonEmail({ firstName: ef, lastName: el, domain: hintLive });
      if (hintOutcome.state === "verified") return { ...patchFromFinder(hintOutcome), altName, companyEmail };
    }
    // Layer 2c — mail domains the company's own website publishes (redirect target /
    // printed addresses). Runs for every unconfirmed row; memoized per website.
    const siteMailDomains = (await liveSiteMailDomainsFor(t.domain).catch(() => [] as string[]))
      .filter((d) => d !== cleanDomain(t.domain!) && d !== hintLive && !extraAltDomains.includes(d));
    for (const dom of siteMailDomains) {
      const o = await findPersonEmail({ firstName: ef, lastName: el, domain: dom });
      if (o.state === "verified") return { ...patchFromFinder(o), altName, companyEmail };
    }
    // Find & verify is binary (Valid | Not found), so an unconfirmed Layer-1/2 outcome
    // (catch-all / opaque / not_found) is NOT an answer: every such row continues
    // through Layer 4 → public sources → Layer 3 → Layer 5. Each layer ends the row
    // ONLY on a reacher-trusted Valid (score >= MIN_VALID_SCORE); anything else falls
    // through to the next layer.

    // Layer 2.5 — sibling / variant domains (deterministic + MX-gated). The mail
    // domain is often a brand sibling of the website (risingwave.com →
    // risingwave-labs.com / risingwavelabs.com / risingwave.io), which L2 never
    // surfaces because the support-email points back at the website. Generate those
    // candidates offline, keep only the ones with LIVE MX (cheap DNS), and add them
    // to the domain set so L4 tries the company's real mail domain. MX-live already,
    // so they're kept even when the website itself is dead-MX.
    let variantDomains: string[] = [];
    if (VARIANT_DOMAIN_LAYER && (t.domain || t.company)) {
      variantDomains = await liveVariantDomainsFor(t.domain, t.company, { country: t.country, companyLinkedin: t.companyLinkedin }).catch(() => []);
    }

    // #3 — on a dead-MX (no_mx) website, drop the dead domain so Layer 4 doesn't
    // waste an SMTP mx-check on it; keep only the (live) alt-domain + variants.
    const domains = uniqueDomains([t.domain, ...extraAltDomains, hintLive, ...siteMailDomains, ...variantDomains]);
    const liveDomains = outcome.state === "no_mx" ? uniqueDomains([...extraAltDomains, hintLive, ...siteMailDomains, ...variantDomains]) : domains;

    // Layer 3a — DIRECT name recovery from the person's OWN LinkedIn URL. Runs BEFORE
    // Layer 4 (and before the slow public-sources scrape) so the culture-aware
    // generator builds the local-part from the FULLER name. Only when we HAVE a
    // profile URL and the slug did NOT already yield a fuller name — the abbreviated-
    // slug case (gohew → "Goh Eng Wei") that bestFullName can't recover. Cheap +
    // targeted (one slug-pinned SERP), so it fits the budget even when SERP is slow.
    if (
      LINKEDIN_NAME_LAYER && t.linkedin && !recoveredDiffers && !altName && !overBudget()
    ) {
      const alt = await findViaLinkedinName(t).catch(() => null);
      if (alt) altName = alt;
    }

    // Layer 4 — culture-aware, FRONT-LOADED. Runs on the website + alt-domain, under
    // the Layer-3a-corrected name when one was recovered (so "Goh Eng Wei" is what
    // generates gohengwei@, not the incomplete stored "Goh Wei").
    if (GLOBAL_PATTERN_LAYER && liveDomains.length) {
      const g = await findViaGlobalPatterns(t, liveDomains, altName).catch(() => null);
      if (g?.valid) return { ...g, altName: g.altName ?? altName, companyEmail };
    }

    // Public-sources: a DIFFERENT published address (personal/parent domain).
    // Company-scoped scrape, so skip it for a bare name+domain input. Skipped once
    // past the row budget (anti-hang).
    if (PUBLIC_SOURCES_LAYER && t.company && !overBudget()) {
      const pub = await findViaPublicSources(t);
      if (pub?.valid) return { ...pub, altName, companyEmail };
    }

    // Layer 3 — reverse role→profile name-correction (crawler SERP). Skipped when
    // the slug already recovered a fuller name (P2), when Layer 3a already corrected
    // the name from the URL (!altName), OR when the title is too generic for a
    // reliable reverse lookup (#4: "Product Owner" etc. → let Layer 5 correct the
    // name instead of burning a SERP on namesakes).
    if (
      NAME_CORRECTION_LAYER && t.company && t.title && !recoveredDiffers && !altName && !overBudget() &&
      titleResolvableForReverseLookup(t.title)
    ) {
      const corr = await findViaNameCorrection(t).catch(() => null);
      if (corr) {
        altName = corr.altName;
        if (corr.result?.valid) return { ...corr.result, altName, companyEmail: corr.result.companyEmail ?? companyEmail };
        if (GLOBAL_PATTERN_LAYER && liveDomains.length) {
          const g2 = await findViaGlobalPatterns(t, liveDomains, altName).catch(() => null);
          if (g2?.valid) return { ...g2, altName, companyEmail };
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
    // Only a REAL L5 find ends the row here; a miss falls through to the same best
    // guess the bulk pass uses (so "Access email" and "Find & verify" agree).
    if (chosen && (chosen.valid || (chosen.found && !!chosen.patch.email))) {
      return { ...chosen, altName: chosen.altName ?? altName, companyEmail: chosen.companyEmail ?? companyEmail };
    }
  }

  // Best guess on the real mail domain (alt-domain first) BEFORE re-checking a stored
  // pattern email: that stored value is our own earlier guess, often on the website domain.
  const bgFirst = await bestGuessPreferMailDomain(t, ef, el);
  if (bgFirst) return { ...bgFirst, altName, companyEmail };

  if (t.email) {
    const v = await cachedVerify(t.email);
    const ev: EmailVerification = { email: v.result.email, status: v.result.status, score: v.result.score, provider: v.provider, verifiedAt: v.result.verifiedAt };
    return { patch: { emailVerification: ev }, valid: trustedValid(v.result), found: false, provider: v.provider };
  }
  // FINAL fallback — every discovery layer missed (the best guess already ran above).
  if (fallback) return { ...fallback, altName, companyEmail };
  // No domain, no mailbox, or every layer empty — persist Not found, keeping a
  // Layer-3a/3 recovered name so the UI still shows the corrected full name.
  return { ...notFoundPatch("reacher"), altName, companyEmail };
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
    // Unique per lookup: the id also scopes the crawler's per-record Decodo budget.
    personId: `finder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
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
  // A source-backed published email (emailKind "found" but SMTP couldn't confirm it
  // on a catch-all/greylisting domain) is a real best-guess, not a miss → accept_all.
  const foundUnconfirmed = !res.valid && res.patch.emailKind === "found" && !!res.patch.email;
  const state: FinderState = res.valid ? "verified" : (res.patch.emailKind === "pattern" || foundUnconfirmed) ? "accept_all" : "not_found";
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

  // Pre-warm the (memoized, once-per-company) variant-domain MX probes for every
  // target in parallel, so the per-result `await liveVariantDomainsFor(...)` inside
  // the loop below are instant cache hits instead of serial ~1s DNS sweeps.
  await Promise.all(targets.map((t) => liveVariantDomainsFor(t.domain, t.company).catch(() => []))).catch(() => {});

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
    // leads after an M&A (Camms → riskonnect.com) — then website + company-email, and
    // finally the MX-live brand SIBLINGS (risingwave.com → risingwave-labs.com) so the
    // deferred catch-all/opaque bulk tail also gets the variant-domain coverage L4 gives.
    const variantDoms = await liveVariantDomainsFor(t.domain, t.company).catch(() => []);
    const domains = uniqueDomains([...(r.domains ?? []), r.domain, t.domain, domainOf(t.companyEmail), ...variantDoms]).slice(0, 4);
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

    // NEW — a source-backed PUBLISHED email the web-search L5 actually READ on a page
    // (impressum / legal / team / speaker bio / directory). It can be a nickname local
    // (jack@ for Giacomo) and/or on the person's CURRENT-employer domain after a job
    // change — cases no name-pattern could ever generate. Trust it BEFORE the pattern
    // sweep: SMTP-confirm when the domain discriminates; on a catch-all / greylisting
    // domain (which SMTP can neither confirm nor deny) surface it anyway as a
    // source-backed find — the published page IS the evidence, not SMTP — but keep the
    // engine's own status (never OVERclaim "valid"). Only a hard SMTP invalid / dead MX
    // rejects it, in which case we fall through to the ordinary pattern sweep.
    const pub = (r.publishedEmail ?? "").toLowerCase().trim();
    // Trust a published address ONLY when it is tied to THIS person, not merely
    // role-matched: the local carries the name, OR it is cross-domain (the LLM found
    // it on the person's current/affiliation domain — a strong per-person signal).
    // This blocks assigning a company/role mailbox (jack@vaudit.com listed for "Head
    // of Product") to the WRONG person who happens to share that title/company.
    const pubLocal = (pub.split("@")[0] ?? "").replace(/[^a-z0-9]/g, "");
    const pubDom = pub.split("@")[1] ?? "";
    const pf = (t.firstName ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const pl = (t.lastName ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const pubNameTied = (pf.length >= 2 && pubLocal.includes(pf)) || (pl.length >= 3 && pubLocal.includes(pl));
    const pubCrossDomain = !!t.domain && !sameCompanyDomain(pubDom, t.domain);
    if (pub && r.publishedEmailSource && r.nameVerified !== false && (pubNameTied || pubCrossDomain) &&
        /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(pub)) {
      try {
        const v = await cachedVerify(pub);
        if (v.result.checks.mx !== "fail") {
          if (trustedValid(v.result)) {
            hit = {
              patch: {
                email: { value: pub, source: "llm", confidence: 88 },
                emailKind: "found",
                emailVerification: { email: pub, status: "valid", score: v.result.score, provider: v.provider, verifiedAt: v.result.verifiedAt },
              },
              valid: true, found: true, provider: v.provider,
            };
          } else if (v.result.status !== "invalid") {
            // Real mailbox per the published source, but the server won't give a
            // definitive verdict (catch-all / greylist / unknown). Surface it with the
            // engine's non-committal status so the row shows the address rather than a
            // false Not-found; it counts as "has email", not "valid".
            const status = v.result.status === "unknown" ? "risky" : v.result.status;
            hit = {
              patch: {
                email: { value: pub, source: "llm", confidence: 70 },
                emailKind: "found",
                emailVerification: { email: pub, status, score: v.result.score || 55, provider: v.provider, verifiedAt: v.result.verifiedAt },
              },
              valid: false, found: true, provider: v.provider,
            };
          }
        }
      } catch { /* engine hiccup → fall through to the pattern sweep below */ }
    }

    for (const dom of domains) {
      if (hit) break;
      // Precision gate: a swept pattern local is trusted as `valid` ONLY on a domain
      // that DISCRIMINATES. On a dumb catch-all (every address comes back deliverable
      // — e.g. blockchain-ads.com) any local, including an LLM nickname guess like
      // `jack@`, false-positives, so a swept guess there is meaningless. classifyDomain
      // is cached (Layer 1 already probed the input domain; an LLM-discovered domain
      // costs one probe). A genuinely published address on a catch-all domain is still
      // surfaced separately by the publishedEmail / public-sources path above.
      const cls = await classifyDomain(dom).catch(() => ({ klass: "opaque" as const }));
      if (cls.klass !== "ok") continue;
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
        // Per-result catch-all guard (backstop to the domain classify above, which is
        // nondeterministic on a latency-flaky catch-all): a `valid` that the engine
        // flags catch-all with NO per-address observation is not a real confirmation,
        // so a blind-swept GUESS there (e.g. an LLM nickname `jack@`) is a false
        // positive. trustedValid rejects it — never surface a guessed local as verified
        // on a dumb catch-all domain (a per-address-observed catch-all still passes).
        if (trustedValid(v.result)) {
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
    // Best-guess fallback is applied by the CALLER (verifyCollectedPeople), so it runs
    // even when this LLM call times out / returns empty. Here we only return real hits.
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
/**
 * Find & verify outcome is binary: Valid or Not found. A DISCOVERED/guessed address
 * whose reacher verdict is anything but `valid` (catch_all, unknown, risky, invalid…)
 * is settled as Not found (no email shown). An imported address that was only
 * re-checked (patch carries no `email` field) is left untouched so user data is never wiped.
 */
function settleNonValid(res: VerifyOneResult): VerifyOneResult {
  const ev = res.patch.emailVerification;
  const keep = ev?.status === "valid" && ev.score >= MIN_VALID_SCORE;
  if (!ev || keep || ev.status === "not_found" || !("email" in res.patch)) return res;
  return { ...notFoundPatch(res.provider), companyEmail: res.companyEmail, altName: res.altName };
}

function patchToPersist(res: VerifyOneResult): PersonPatch {
  res = settleNonValid(res);
  let patch = res.patch;
  if (res.companyEmail) patch = { ...patch, companyEmail: res.companyEmail };
  if (res.altName) patch = { ...patch, altName: res.altName };
  return patch;
}

function persistLookup(jobId: string, personId: string, res: VerifyOneResult): SinglePersonVerifyResult {
  res = settleNonValid(res); // so the returned status matches what is stored
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

  // Seed each domain's KNOWN convention from every already-confirmed email in the
  // store (this + other jobs). A company uses ONE pattern, so one verified colleague
  // (e.g. john@acme.com → "first") lets us resolve the rest of acme.com's people even
  // when their servers are catch-all/opaque and can't SMTP-verify a single address.
  // Runs AFTER the route's clearDomainCache(), so it repopulates the just-cleared cache.
  seedDomainPatternsFromStore();

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

  // Settle an engine-flaky row as a TRANSIENT unknown (never a false Not-found):
  // status "unknown" is not a real verdict, so it is NOT sealed and the row stays
  // in the "Not searched" bucket, ready for the next pass. This is what lets a
  // stray engine error skip ONE row WITHOUT aborting the whole run — the fix for
  // the "Verification interrupted" abort.
  const transientUnknown = (): PersonPatch => ({
    emailVerification: { email: "", status: "unknown", score: 0, provider: "reacher", verifiedAt: now() },
  });
  let engineFailures = 0;

  const handleRow = async (t: store.PersonVerifyTarget) => {
    store.markPersonVerifying(jobId, t.personId, true);
    try {
      let res: VerifyOneResult | null = null;
      let engineFailed = false;
      let timedOut = false;
      try {
        // Hard per-row deadline: a single row can never wedge a worker (no-hang
        // guarantee). verifyOne keeps its own layer timeouts; this is the backstop.
        const raced = await Promise.race([
          verifyOne(t, { skipLlm: true }),
          sleep(ROW_HARD_MS).then(() => "DEADLINE" as const),
        ]);
        if (raced === "DEADLINE") timedOut = true;
        else res = raced;
      } catch (e) {
        // A per-row engine failure is TRANSIENT — the backend already retries
        // internally and reacher is verified healthy under load — so NEVER abort
        // the whole pass. Mark this row transient-unknown and carry on.
        if (e instanceof VerifierUnavailableError) engineFailed = true;
        else res = null; // any other error → treat this one row as Not found
      }
      if (engineFailed) {
        store.updatePersonResolved(jobId, t.personId, transientUnknown());
        engineFailures++;
      } else if (timedOut || !res) {
        apply(t, notFoundPatch("reacher"));
      } else if (res.needsLlm) {
        if (res.companyEmail) deferredCompanyEmail.set(t.personId, res.companyEmail);
        if (res.altName) deferredAltName.set(t.personId, res.altName);
        // Provisional Not-found NOW so the row leaves "Not searched" immediately
        // (live progress instead of a frozen count until the terminal L5 batch).
        // The L5 pass UPGRADES it in place if it resolves a mailbox. In-memory
        // patch only; the final apply() in the L5 loop counts each row once.
        store.updatePersonResolved(jobId, t.personId, patchToPersist(res));
        // Hand L5 the Layer-2 company email so it also tries the real mail domain.
        pendingLlm.push(res.companyEmail && !t.companyEmail ? { ...t, companyEmail: res.companyEmail } : t);
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

  await runPool(probes, CONCURRENCY); // learn one pattern per domain
  await runPool(rest, CONCURRENCY); // fast fill — reuses learned patterns

  if (pendingLlm.length > 0) {
    // L5 never aborts the pass: fillWithLlmStructure already swallows engine/LLM
    // errors per row (returns Not-found), and this guard catches anything else so
    // the pass always reaches its clean "done" state (no verifying→idle, which is
    // what surfaced the "Verification interrupted" toast).
    try {
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
        const hit = llmHits.get(t.personId);
        // Did L5 find a REAL address? (valid, or a web-found/published email.) If not —
        // which includes the common case where the LLM call timed out / returned empty
        // (e.g. a cheap model with no web_search, or a huge batch) — fall back to a
        // best guess HERE, in the caller, so it ALWAYS applies regardless of the LLM.
        const real = !!hit && (hit.valid || (hit.found && !!hit.patch.email));
        const r = real ? hit! : ((await bestGuessPreferMailDomain(t, t.firstName, t.lastName)) ?? hit ?? notFoundPatch("reacher"));
        const ce = deferredCompanyEmail.get(t.personId);
        const an = deferredAltName.get(t.personId);
        apply(t, {
          ...r,
          companyEmail: r.companyEmail ?? ce,
          altName: r.altName ?? an,
        });
      }
    } catch (e) {
      console.error(`[verify-emails] L5 phase error for ${jobId} (continuing):`, e);
      // Even if the whole L5 phase threw, still surface best guesses so the pass isn't
      // a wall of Not-found on unverifiable domains.
      for (const t of pendingLlm) {
        const bg = await bestGuessPreferMailDomain(t, t.firstName, t.lastName);
        if (bg) apply(t, { ...bg, companyEmail: deferredCompanyEmail.get(t.personId), altName: deferredAltName.get(t.personId) });
      }
    }
  }

  if (engineFailures > 0) {
    console.warn(`[verify-emails] ${jobId}: ${engineFailures} row(s) hit transient engine errors and stay Not searched (re-run to retry).`);
  }
  store.setVerifyingPersonIds(jobId, []);
  store.commitVerification(jobId);
  store.setJobVerifyStatus(jobId, "done");
  store.sealMissedEmailLookups(jobId);
  store.flushNow(); // durably persist the final state (throttled saves may be pending)
  const provider: "reacher" | "none" = providers.has("reacher") ? "reacher" : "none";
  return { verified, valid, found, provider };
}

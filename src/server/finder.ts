/**
 * Server-side Email Finder pipeline.
 *
 * Runs the whole "find one person's email" flow in a single server operation,
 * the way dedicated providers (Hunter, Apollo, Snov) do - instead of the FE
 * firing one verification request per candidate.
 *
 * Accuracy-first strategy: we let the backend's per-mailbox verdict decide,
 * exactly like the single-email verifier. We verify candidates in pattern-
 * priority order and stop ONLY when the backend confirms a real mailbox:
 *   - `valid`     -> the person's real, deliverable email. Stop; learn the
 *                    winning pattern for this domain.
 *   - `mx` failed -> the domain has no mail server at all -> `no_mx` (stop).
 *   - `catch_all` / invalid / risky -> inconclusive for THIS guess; keep going.
 *     A catch-all on one address does NOT mean the rest are catch-all, so we
 *     must still probe the other patterns to find one the backend can confirm.
 * If nothing is confirmed, we surface the strongest catch-all (accept_all) or,
 * failing that, the best-guess format (not_found).
 *
 * Caching: only two facts are safe to cache without hurting accuracy - a dead
 * domain (no MX) short-circuits future lookups, and a learned winning pattern
 * is verified first so a known-format domain confirms on the first call.
 */
import "server-only";
import { cachedVerify } from "./verification";
import { buildCandidates, buildEmailForPattern, cleanDomain, priorNormForLabel, EMAIL_PATTERNS } from "@/lib/finder/patterns";
import { verifyRanked } from "@/lib/finder/verify-orchestration";
import type { BulkFinderResponse, BulkFinderResult, FinderOutcome, FinderResult, FinderState, VerificationResult } from "@/lib/types";

/* ----------------------------- domain cache ----------------------------- */

/**
 * We cache only ONE positive, stable fact per domain: the pattern that produced
 * a backend-confirmed `valid` mailbox. It's used purely to reorder candidates
 * (verify the known-good format first) — never to skip a live check. Nothing
 * transient (catch-all, no-MX, unknown) and nothing mock-derived is cached, so
 * the finder's verdicts always come from a live backend call.
 */
interface DomainFacts {
  winningPattern?: string; // pattern label that produced a confirmed mailbox
  deadMx?: boolean; // the domain has NO mail server → nothing on it is deliverable
  catchAll?: boolean; // server accepts EVERY address → a "valid" verdict is meaningless
  catchAllScore?: number; // the accept-all probe's score (reused by score-based acceptance; no re-probe)
  opaque?: boolean; // server won't verify (returns "unknown" for everyone) → can't confirm
  // The domain's KNOWN email convention, LEARNED from a colleague's confirmed/published
  // email on this exact domain (not from SMTP-probing this person). Lets us resolve
  // colleagues on a catch-all / opaque domain — where their own address can't be
  // SMTP-verified — using the company's proven pattern. `knownPatternWeight` counts the
  // corroborating colleagues (more = higher confidence).
  knownPatternId?: string; // EmailPattern id, e.g. "first" / "first.last"
  knownPatternWeight?: number;
  at: number; // epoch ms
}
export type DomainClass = "ok" | "catchall" | "opaque" | "dead";

const DOMAIN_TTL_MS = Number(process.env.FINDER_DOMAIN_TTL_MS ?? 7 * 24 * 3600 * 1000);
// A "no MX" fact gets a SHORTER TTL than a winning pattern — an MX lookup is
// stable, but a shorter TTL bounds the blast radius of a transient DNS failure
// being cached as "dead". Lets colleagues at a dead domain skip the mx-check.
const DEAD_MX_TTL_MS = Number(process.env.FINDER_DEAD_MX_TTL_MS ?? 3_600_000);

// The domain-classification probe (one bogus address per new domain) runs on a
// SHORT deadline: a reachable, well-behaved mail server answers a single RCPT in
// a few seconds. A domain whose probe does NOT answer in time is tarpitting or
// unreachable — reacher would spend ~60s per address there (verified live:
// tarpitting customer domains take ~61s PER check), and a "hard" row runs ~20-30
// checks, so ONE such domain froze the People pass for minutes. We conclude such a
// domain is verification-opaque from the timed-out probe and skip the futile sweep
// (recall-safe: a real mailbox is unobtainable from a server that won't answer;
// these domains return not_found either way, just ~4× faster). Tune / disable
// (set very high) with FINDER_CLASSIFY_TIMEOUT_MS.
const CLASSIFY_TIMEOUT_MS = Number(process.env.FINDER_CLASSIFY_TIMEOUT_MS ?? 15_000);

/**
 * Confidence bar for reporting an email as found when the backend could NOT
 * confirm it as `valid`. Catch-all addresses score ~40-54, so with the default
 * (60) they fall below the bar and are reported as "not found" rather than a
 * misleading low-confidence guess. Tune with FINDER_MIN_SCORE.
 */
const MIN_CONFIDENCE = Number(process.env.FINDER_MIN_SCORE ?? 60);

/**
 * SCORE-BASED ACCEPTANCE (product policy). On a domain the engine cannot per-address
 * CONFIRM — a catch-all / accept-all (Google Workspace, M365) or greylisting server —
 * reacher never returns a clean `valid`, so the strict path reports Not-found even for
 * a real, deliverable mailbox. Policy: when reacher scores an address ABOVE the bar
 * (> MIN_CONFIDENCE, i.e. > 60) it IS the person's real email. We surface the company's
 * CONVENTION address (the pattern LEARNED from a confirmed colleague → else the most-
 * common `first.last`) rather than a blind sweep, so we don't over-claim a random local.
 * Set FINDER_SCORE_ACCEPT=0 to return to strict confirmed-only behaviour.
 */
const SCORE_ACCEPT = (process.env.FINDER_SCORE_ACCEPT ?? "1") !== "0";

/**
 * How many candidates to SMTP-verify in parallel (after the priority-0 candidate
 * is tried alone). The sweep is I/O-bound (SMTP waits), so a handful at once
 * turns a slow N-serial not-found sweep into a few bounded-parallel batches
 * without changing which candidate wins. Tune with FINDER_CANDIDATE_CONCURRENCY.
 */
// NOTE: keep this MODEST. The backend confirms mailboxes on catch-all domains via
// a LATENCY comparison (target vs. control response times); too many concurrent SMTP
// probes to the same server distort those timings and cause FALSE positives (a bogus
// address wrongly measured "likely_real"). 5 was empirically accurate; 10 was not.
const FINDER_CANDIDATE_CONCURRENCY = Math.max(1, Math.min(Number(process.env.FINDER_CANDIDATE_CONCURRENCY ?? 5), 12));

declare global {
  // eslint-disable-next-line no-var
  var __finderDomainCache: Map<string, DomainFacts> | undefined;
}

function cache(): Map<string, DomainFacts> {
  if (!globalThis.__finderDomainCache) globalThis.__finderDomainCache = new Map();
  return globalThis.__finderDomainCache;
}

/** Clear the per-domain fact cache. Returns how many entries were removed. */
export function clearDomainCache(): number {
  const n = cache().size;
  cache().clear();
  return n;
}

/**
 * Seed a domain's KNOWN email convention, learned from a colleague's confirmed or
 * published email on this exact domain (see people-verify's pass-start seeding).
 * The most-corroborated pattern wins. This does NOT expire with the negative-fact
 * TTL — a company's convention is stable — so it is stored with a fresh timestamp
 * and only the long TTL applies. Used to resolve colleagues on domains SMTP cannot
 * verify (catch-all / opaque).
 */
export function seedDomainPattern(domain: string, patternId: string, weight = 1): void {
  const d = cleanDomain(domain);
  if (!d || !patternId) return;
  const cur = cache().get(d);
  // Keep the pattern with the highest cumulative weight across colleagues.
  if (cur?.knownPatternId && cur.knownPatternId !== patternId) {
    const curW = cur.knownPatternWeight ?? 1;
    if (weight <= curW) { // existing pattern still dominant → just accumulate nothing
      cache().set(d, { ...cur, at: Date.now() });
      return;
    }
  }
  const sameW = cur?.knownPatternId === patternId ? (cur?.knownPatternWeight ?? 0) : 0;
  cache().set(d, { ...(cur ?? {}), knownPatternId: patternId, knownPatternWeight: sameW + weight, at: Date.now() });
}

/** The learned convention for a domain, if any. */
export function knownDomainPattern(domain: string): { patternId: string; weight: number } | null {
  const f = cache().get(cleanDomain(domain));
  if (f?.knownPatternId) return { patternId: f.knownPatternId, weight: f.knownPatternWeight ?? 1 };
  return null;
}

// Data-driven GLOBAL fallback pattern — the single most common convention across ALL
// confirmed emails in the store (for this population "first" ≈ 58%). Used as a LAST-
// resort weak guess on an unverifiable domain with no colleague signal, so a reachable
// row still gets a likely address instead of a bare not_found. Surfaced at LOW
// confidence (clearly a guess, never "valid"). Off unless a pass seeds it.
declare global {
  // eslint-disable-next-line no-var
  var __finderGlobalPattern: string | null | undefined;
}
export function setGlobalFallbackPattern(patternId: string | null): void {
  globalThis.__finderGlobalPattern = patternId;
}
export function globalFallbackPattern(): string | null {
  return globalThis.__finderGlobalPattern ?? null;
}
// Master switch for surfacing UNVERIFIED best guesses (both colleague-inherited and the
// global-prior fallback) on domains SMTP cannot verify. Recall-maximising; set
// PEOPLE_VERIFY_BEST_GUESS=0 to return to strict "confirmed-only" behaviour.
const BEST_GUESS = (process.env.PEOPLE_VERIFY_BEST_GUESS ?? "1") !== "0";
// Whether to also use the low-confidence GLOBAL prior (no colleague signal). On by
// default with BEST_GUESS; PEOPLE_VERIFY_BEST_GUESS_GLOBAL=0 keeps only the
// high-confidence colleague-inherited guesses.
const BEST_GUESS_GLOBAL = (process.env.PEOPLE_VERIFY_BEST_GUESS_GLOBAL ?? "1") !== "0";

function getFacts(domain: string): DomainFacts | undefined {
  const f = cache().get(domain);
  if (!f) return undefined;
  // Negative "can't verify" facts (dead / transiently-opaque) get a SHORT TTL;
  // a stable winning-pattern / catch-all config keeps the long TTL.
  const ttl = f.deadMx || f.opaque ? DEAD_MX_TTL_MS : DOMAIN_TTL_MS;
  if (Date.now() - f.at > ttl) {
    cache().delete(domain);
    return undefined;
  }
  return f;
}

/** Merge facts into a domain's cache entry (preserve existing pattern/class). */
function mergeFacts(domain: string, patch: Partial<DomainFacts>): void {
  cache().set(domain, { ...(cache().get(domain) ?? {}), ...patch, at: Date.now() });
}

/** Learn a domain's winning pattern — from a REAL backend `valid` result only. */
function learnWinningPattern(domain: string, winningPattern: string, provider: "reacher"): void {
  if (provider !== "reacher") return; // never cache facts derived from the mock fallback
  mergeFacts(domain, { winningPattern });
}

/** Remember a domain has NO mail server so colleagues skip the (futile) mx-check. */
function markDeadDomain(domain: string, provider: "reacher"): void {
  if (provider !== "reacher") return;
  cache().set(domain, { deadMx: true, at: Date.now() });
}

/**
 * Classify a domain ONCE (cached) by probing a random, almost-certainly-
 * nonexistent local-part — so we never waste ~30 per-candidate SMTP checks on a
 * domain that CANNOT return a trustworthy `valid`:
 *   - dead        → no MX (nothing deliverable).
 *   - catchall    → accepts EVERY address (a "valid" verdict is meaningless).
 *   - opaque      → server won't verify (returns "unknown" for everyone).
 *   - ok          → rejects the bogus address → per-mailbox verdicts are trustworthy.
 * The verdict is cached per domain, so on a big list only the FIRST person at each
 * domain pays the probe; the rest reuse it and skip a futile full sweep.
 */
export async function classifyDomain(domain: string): Promise<{ klass: DomainClass; calls: number }> {
  const f = getFacts(domain);
  if (f?.deadMx) return { klass: "dead", calls: 0 };
  if (f?.catchAll) return { klass: "catchall", calls: 0 };
  if (f?.opaque) return { klass: "opaque", calls: 0 };

  const rand = `zzq-no-user-${Math.random().toString(36).slice(2, 11)}`;
  let v: Awaited<ReturnType<typeof cachedVerify>>;
  try {
    v = await cachedVerify(`${rand}@${domain}`, { fresh: true, timeoutMs: CLASSIFY_TIMEOUT_MS });
  } catch {
    return { klass: "opaque", calls: 1 }; // treat an error as inconclusive (don't cache)
  }
  const calls = v.cached ? 0 : 1;
  if (v.provider !== "reacher") return { klass: "ok", calls }; // mock → behave normally, don't classify
  // Probe did not answer within the short classify deadline → tarpit / unreachable
  // server. Cache it opaque so this row skips the (per-address ~60s) sweep and every
  // colleague at the domain skips too. Recall-safe: a mailbox that a server won't
  // confirm in time is not obtainable; the row settles not_found either way.
  if (v.timedOut) { markOpaqueDomain(domain, v.provider); return { klass: "opaque", calls }; }
  const r = v.result;
  if (r.checks.mx === "fail") { markDeadDomain(domain, v.provider); return { klass: "dead", calls }; }
  // ONLY a bogus address coming back `valid` (is_reachable "safe") proves a TRUE
  // "dumb" catch-all — the server marks EVERY address deliverable, so a per-mailbox
  // `valid` is meaningless and a sweep would false-positive. Skip those.
  if (r.status === "valid") { mergeFacts(domain, { catchAll: true, catchAllScore: r.score }); return { klass: "catchall", calls }; }
  // A `catch_all` / `risky` / `role` verdict on a BOGUS address means the server
  // accepted-but-FLAGGED it — it WITHHELD `valid` from a nonexistent mailbox. Such a
  // server DISCRIMINATES (this backend's catch-all latency test): a REAL mailbox that
  // comes back `valid` is trustworthy, a guess never is. So DON'T skip — sweep it, and
  // early-exit picks the one real address (e.g. Vietnamese `thild` on a Google
  // Workspace catch-all). `invalid` (discriminating) proceeds to the sweep too.
  if (r.status === "invalid") return { klass: "ok", calls };
  // `unknown` for a BOGUS address = the server won't answer for any mailbox
  // (greylist / block / tarpit). It cannot verify anyone here, so a per-address sweep
  // is futile — mark it opaque now (skips the sweep → much faster) so the People pass
  // best-guesses these rows from the domain convention instead of a wall of Not-found.
  if (r.status === "unknown") { markOpaqueDomain(domain, v.provider); return { klass: "opaque", calls }; }
  // catch_all / risky / role on bogus → discriminating catch-all; sweep to find a real one.
  return { klass: "ok", calls };
}

/** Cache a domain as verification-opaque (proven all-unknown by a full sweep). */
function markOpaqueDomain(domain: string, provider: "reacher"): void {
  if (provider !== "reacher") return;
  mergeFacts(domain, { opaque: true });
}

/** Cached domain class for a domain the finder already classified this pass (else "ok"). */
export function cachedDomainClass(domain: string): DomainClass {
  const f = getFacts(cleanDomain(domain));
  if (f?.deadMx) return "dead";
  if (f?.catchAll) return "catchall";
  if (f?.opaque) return "opaque";
  return "ok";
}

/* ------------------------------- helpers -------------------------------- */

/**
 * A backend `valid` we can TRUST as a real, per-mailbox confirmation. On a catch-all
 * domain a `valid` (reacher "safe") is only trustworthy when the engine actually made
 * a PER-ADDRESS observation for it; a "dumb" catch-all marks EVERY address deliverable
 * (blockchain-ads.com), so a `valid` there with no per-address observation is a false
 * positive — reject it. Non-catch-all domains are unaffected; a discriminating catch-all
 * (per-address observed, e.g. resourceledger.com) still passes.
 */
function trustedValid(r: VerificationResult): boolean {
  return r.status === "valid" && (!r.checks.catchAll || r.perAddressObservation === true);
}

function toResult(
  email: string,
  patternLabel: string,
  name: string,
  domain: string,
  status: FinderResult["status"],
  score: number,
  bestGuess = false,
): FinderResult {
  return {
    id: "finder_best",
    email,
    score,
    pattern: patternLabel,
    source: "server finder",
    name,
    domain,
    status,
    bestGuess,
  };
}

function outcome(
  result: FinderResult,
  state: FinderState,
  smtpCalls: number,
  skipped: number,
  provider: "reacher",
  fromCache: boolean,
): FinderOutcome {
  return { result, state, smtpCalls, skipped, provider, fromCache };
}

/**
 * LAST-RESORT best-guess email for a person on a domain SMTP could not verify, used by
 * the People pipeline ONLY AFTER every discovery layer (patterns, alt-domain, culture,
 * public-sources, LLM) has missed — never inside the finder itself, so it can never
 * short-circuit a real find. Two tiers:
 *   • the domain's convention LEARNED from a confirmed colleague → HIGH confidence
 *     (74..86 by corroboration); a company uses one format, so this is usually right.
 *   • else the data-driven GLOBAL-dominant pattern → LOW confidence (50): a weak guess.
 * Returns null when best-guessing is off or nothing applies. Never claims SMTP "valid".
 */
export function bestGuessEmail(domain: string, first: string, last: string): { email: string; label: string; confidence: number } | null {
  if (!BEST_GUESS || !domain || !first || !last) return null;
  const known = knownDomainPattern(domain);
  let patternId: string | null = null;
  let confidence = 0;
  if (known) {
    patternId = known.patternId;
    confidence = Math.min(86, 74 + Math.min(known.weight, 3) * 4);
  } else if (BEST_GUESS_GLOBAL) {
    patternId = globalFallbackPattern();
    confidence = 50;
  }
  if (!patternId) return null;
  const built = buildEmailForPattern(patternId, first, last, domain);
  if (!built) return null;
  return { email: built.email, label: built.label, confidence };
}

/**
 * The company's CONVENTION address for this person on a domain SMTP can't confirm:
 * the pattern LEARNED from a confirmed colleague if we have one, else the single
 * most-common format (`first.last`). Used by the score-based acceptance path.
 */
function conventionEmail(domain: string, first: string, last: string): { email: string; label: string } | null {
  const known = knownDomainPattern(domain);
  const patternId = known?.patternId ?? EMAIL_PATTERNS[0].id; // EMAIL_PATTERNS[0] === first.last
  const built = buildEmailForPattern(patternId, first, last, domain);
  return built ? { email: built.email, label: built.label } : null;
}

/**
 * Score-based acceptance for a catch-all / accept-all domain the engine can't
 * per-address confirm. Crucially this makes NO new backend call: the domain was
 * already probed once by `classifyDomain`, and on a dumb accept-all EVERY address —
 * including the convention — is treated identically, so the probe's stored
 * `catchAllScore` IS the convention address's score. If that score is above the bar
 * (> MIN_CONFIDENCE) the domain accepts mail there and, per policy, it is the
 * person's real email → surface the CONVENTION address (learned → else first.last)
 * as `verified`. Otherwise honest `not_found`. Synchronous + zero SMTP, so a
 * catch-all row costs nothing beyond the one shared per-domain classify probe
 * (this is the fix for the per-row-SMTP hang the earlier version introduced).
 */
function acceptConventionByScore(
  domain: string,
  first: string,
  last: string,
  name: string,
  calls: number,
  provider: "reacher",
): FinderOutcome {
  const conv = conventionEmail(domain, first, last);
  const score = getFacts(domain)?.catchAllScore ?? 0;
  if (SCORE_ACCEPT && conv && score > MIN_CONFIDENCE) {
    const fr = toResult(conv.email, conv.label, name, domain, "valid", score);
    return outcome({ ...fr, bestGuess: true }, "verified", calls, 0, provider, calls === 0);
  }
  return outcome(
    toResult(conv?.email ?? `@${domain}`, conv?.label ?? "{first}.{last}", name, domain, "unverified", 0),
    "not_found", calls, 0, provider, calls === 0,
  );
}

/* ------------------------------- pipeline ------------------------------- */

export async function findPersonEmail(input: {
  firstName: string;
  lastName: string;
  domain: string;
}): Promise<FinderOutcome> {
  const name = `${input.firstName} ${input.lastName}`.trim();
  const candidates = buildCandidates(input.firstName, input.lastName, input.domain);
  const domain = candidates[0]?.email.split("@")[1] ?? cleanDomain(input.domain);

  // Nothing to try (blank name or unparseable domain).
  if (candidates.length === 0 || !domain) {
    return outcome(
      toResult(`@${domain}`, "{first}.{last}", name, domain, "unverified", 0),
      "not_found",
      0,
      0,
      "reacher",
      false,
    );
  }

  const total = candidates.length;
  const cached = getFacts(domain);
  let calls = 0; // real backend calls made (per-email cache hits don't count)
  let provider: "reacher" = "reacher";

  // Known dead domain (no MX) → nothing is deliverable; skip the SMTP mx-check
  // entirely. Big saver when many colleagues share a dead website domain.
  if (cached?.deadMx) {
    return outcome(
      toResult(candidates[0].email, candidates[0].patternLabel, name, domain, "invalid", 0),
      "no_mx",
      0,
      total,
      "reacher",
      true,
    );
  }

  // Check the learned winning pattern first so a known-format domain confirms
  // on the first call - but every candidate stays eligible and live-checked.
  const ordered = [...candidates];
  if (cached?.winningPattern) {
    const i = ordered.findIndex((c) => c.patternLabel === cached.winningPattern);
    if (i > 0) ordered.unshift(ordered.splice(i, 1)[0]);
  }

  // Classify the domain ONCE (cached). Skip the full candidate sweep when the
  // server CAN'T yield a trustworthy `valid` — the biggest speed win on the slow,
  // unresolvable domains (a catch-all or verification-blocking server would else
  // cost ~N futile SMTP checks per person). Precision-preserving: we never claim
  // an email is valid on such a domain (we report not_found), and a discriminating
  // domain still gets the full trustworthy sweep.
  // If a PRIOR full sweep already proved this domain opaque (all-unknown) or it's
  // catch-all, skip the futile sweep — colleagues resolve instantly. Only these
  // RELIABLE classes short-circuit; a first-seen domain always gets the full sweep.
  const preClass = cachedDomainClass(domain);
  // Catch-all / accept-all (known from a prior probe): the engine can't per-address
  // confirm, so instead of a bare Not-found, apply the score-based acceptance on the
  // company's convention address (learned → else first.last).
  if (preClass === "catchall") {
    return acceptConventionByScore(domain, input.firstName, input.lastName, name, 0, provider);
  }
  // Verification-opaque (a prior full sweep proved EVERY address `unknown`): the server
  // won't score any mailbox above the bar, so score-based acceptance can't help — fast
  // Not-found (unchanged).
  if (preClass === "opaque") {
    return outcome(toResult(candidates[0].email, candidates[0].patternLabel, name, domain, "unverified", 0), "not_found", 0, total, provider, true);
  }
  // Otherwise probe ONCE for catch-all/dead (reliable from one bogus-address probe)
  // to avoid a futile sweep on those; `unknown`/`invalid` fall through to the full
  // sweep (no recall loss — a greylisting domain still verifies its real mailbox).
  if (!cached?.winningPattern) {
    const cls = await classifyDomain(domain);
    calls += cls.calls;
    if (cls.klass === "dead") {
      return outcome(toResult(candidates[0].email, candidates[0].patternLabel, name, domain, "invalid", 0), "no_mx", calls, total, provider, calls === 0);
    }
    if (cls.klass === "catchall") {
      // Accept-all domain: surface the convention address when reacher scores it > 60.
      return acceptConventionByScore(domain, input.firstName, input.lastName, name, calls, provider);
    }
    // Tarpit / unreachable server (the probe timed out): skip the futile per-address
    // sweep — each check would cost the full deadline. Colleagues already short-
    // circuit via `preClass` above; this makes the FIRST row on the domain fast too.
    if (cls.klass === "opaque") {
      return outcome(toResult(candidates[0].email, candidates[0].patternLabel, name, domain, "unverified", 0), "not_found", calls, total, provider, calls === 0);
    }
  }

  // Verify candidates, letting the backend's per-mailbox verdict decide. Ranked-
  // parallel: the priority-0 candidate (learned pattern) is checked alone first,
  // the rest in parallel — SAME winner as a strict sequential scan, just faster.
  // Stop ONLY on a confirmed `valid`; a `catch_all` on one guess does not rule out
  // a real mailbox on another pattern.
  const { winner, mxFail, results } = await verifyRanked(
    ordered,
    (email) => cachedVerify(email),
    (v) => trustedValid(v.result),
    (v) => v.result.checks.mx === "fail",
    { concurrency: FINDER_CANDIDATE_CONCURRENCY },
  );
  calls = results.filter((p) => !p.result.cached).length;
  provider = results[results.length - 1]?.result.provider ?? provider;
  const checked: FinderResult[] = results.map((p) => toResult(p.cand.email, p.cand.patternLabel, name, domain, p.result.result.status, p.result.result.score));

  // No MX -> nothing on the domain is deliverable (verdict comes from BE). Cache
  // the dead-domain fact so colleagues skip the mx-check.
  if (mxFail) {
    markDeadDomain(domain, provider);
    const dead = results.find((p) => p.result.result.checks.mx === "fail")!;
    const fr = toResult(dead.cand.email, dead.cand.patternLabel, name, domain, "invalid", dead.result.result.score);
    return outcome({ ...fr, status: "invalid" }, "no_mx", calls, total - checked.length, provider, calls === 0);
  }
  // Confirmed deliverable mailbox -> this is the person's real email.
  if (winner) {
    // Confirm-in-isolation: on a catch-all domain the backend tells a real mailbox
    // from a bogus one by RESPONSE LATENCY, and the concurrent sweep can distort
    // that timing into a FALSE `valid` (measured e.g. `rob@`/`mx@` valid mid-sweep
    // but `risky` when checked alone). If the winner wasn't the isolated priority-0
    // check, re-run the SAME verification once, ALONE, and require `valid` again.
    // (Verify logic untouched — this just removes sweep interference.)
    let confirmedScore = winner.result.result.score;
    let confirmed = winner.cand.email === ordered[0].email; // priority-0 was isolated
    if (!confirmed) {
      const c = await cachedVerify(winner.cand.email, { fresh: true }).catch(() => null);
      if (c && !c.cached) calls++;
      confirmed = !!c && trustedValid(c.result);
      if (c) confirmedScore = c.result.score;
    }
    if (confirmed) {
      learnWinningPattern(domain, winner.cand.patternLabel, provider);
      const fr = toResult(winner.cand.email, winner.cand.patternLabel, name, domain, "valid", confirmedScore);
      return outcome({ ...fr, bestGuess: true }, "verified", calls, total - checked.length, provider, calls === 0);
    }
    // Sweep-induced false `valid` on a catch-all → no trustworthy mailbox found.
    return outcome(
      toResult(candidates[0].email, candidates[0].patternLabel, name, domain, "unverified", 0),
      "not_found", calls, total - checked.length, provider, calls === 0,
    );
  }

  // Post-sweep opacity: EVERY candidate came back `unknown` (MX alive, but the
  // server neither confirms nor rejects any mailbox). Now — after a full,
  // recall-safe sweep — we can reliably conclude the domain is verification-opaque
  // and cache it, so colleagues skip the futile sweep. (One `invalid`/`valid`
  // anywhere means the server DOES discriminate, so we do NOT mark it opaque.)
  // Unverifiable domain: the sweep produced NO definitive verdict — no `valid` winner
  // and not a single `invalid` (all unknown / catch_all / risky / role). The server
  // won't confirm OR reject any address here, so its convention can't be pattern-tested.
  // Mark it opaque so the People pass surfaces a best guess (domain convention / global
  // prior) instead of Not-found. A single `invalid` anywhere means it DOES discriminate,
  // so we leave it "ok" (patterns were genuinely tested → a guess would be wrong).
  const anyDefinitive = results.some((p) => p.result.result.status === "valid" || p.result.result.status === "invalid");
  if (results.length > 0 && !anyDefinitive) {
    markOpaqueDomain(domain, provider);
  }

  // No candidate was confirmed deliverable. Rank the guesses by score, then
  // apply the confidence bar: a catch-all/rejected result below the bar is NOT
  // evidence the mailbox exists, so report "not found" instead of a low guess.
  const best =
    [...checked].sort((a, b) => b.score - a.score || priorNormForLabel(b.pattern) - priorNormForLabel(a.pattern))[0] ??
    toResult(candidates[0].email, candidates[0].patternLabel, name, domain, "unverified", 0);

  if (best.status !== "invalid" && best.score > MIN_CONFIDENCE) {
    // A swept candidate scored ABOVE the bar but the engine withheld a clean `valid`
    // (greylisting / catch_all / risky server). Per the score-based policy this IS a
    // real, deliverable mailbox. Prefer the LEARNED convention address when it also
    // cleared the bar in this sweep (so a company that uses first_last isn't shown
    // first.last just because it sorted first on a tie); else take the top-scoring one.
    let pick = best;
    const known = knownDomainPattern(domain);
    if (known) {
      const kb = buildEmailForPattern(known.patternId, input.firstName, input.lastName, domain);
      const kr = kb && checked.find((c) => c.email === kb.email);
      if (kr && kr.status !== "invalid" && kr.score > MIN_CONFIDENCE) pick = kr;
    }
    if (SCORE_ACCEPT) {
      return outcome({ ...pick, status: "valid", bestGuess: true }, "verified", calls, 0, provider, calls === 0);
    }
    // Strict mode (SCORE_ACCEPT off): plausible but unconfirmed → accept_all (old behaviour).
    return outcome({ ...pick, bestGuess: true }, "accept_all", calls, 0, provider, calls === 0);
  }
  // Below the bar -> we cannot claim this email exists. Report not found; the
  // closest format is retained only as a hint (no positive score is shown).
  return outcome({ ...best, bestGuess: false }, "not_found", calls, 0, provider, calls === 0);
}

/* ------------------------------ bulk finder ----------------------------- */

export type BulkPerson = BulkFinderResult["input"];

/**
 * Find emails for many people at once (P4). Runs the finder with bounded
 * concurrency so all requests share the same domain and per-email caches:
 * people at the same company reuse the learned pattern / no-MX fact, and
 * duplicate addresses are served from the email cache.
 */
export async function findManyEmails(
  people: BulkPerson[],
  opts: { concurrency?: number } = {},
): Promise<BulkFinderResponse> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 5, 10));
  const results: BulkFinderResult[] = new Array(people.length);
  let backendCalls = 0;
  let next = 0;

  async function worker() {
    while (next < people.length) {
      const i = next++;
      const person = people[i];
      const result = await findPersonEmail(person);
      backendCalls += result.smtpCalls;
      results[i] = { input: person, outcome: result };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, people.length) }, worker));

  // A naive finder verifies every pattern for every person with no caching.
  const patternsPerPerson = buildCandidates("first", "last", "example.com").length;
  const naiveCalls = people.length * patternsPerPerson;

  return {
    results,
    stats: { people: people.length, backendCalls, naiveCalls, saved: Math.max(0, naiveCalls - backendCalls) },
  };
}

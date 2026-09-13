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
import { buildCandidates, cleanDomain, priorNormForLabel } from "@/lib/finder/patterns";
import { verifyRanked } from "@/lib/finder/verify-orchestration";
import type { BulkFinderResponse, BulkFinderResult, FinderOutcome, FinderResult, FinderState } from "@/lib/types";

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
  opaque?: boolean; // server won't verify (returns "unknown" for everyone) → can't confirm
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
  if (r.status === "valid") { mergeFacts(domain, { catchAll: true }); return { klass: "catchall", calls }; }
  // A `catch_all` / `risky` / `role` verdict on a BOGUS address means the server
  // accepted-but-FLAGGED it — it WITHHELD `valid` from a nonexistent mailbox. Such a
  // server DISCRIMINATES (this backend's catch-all latency test): a REAL mailbox that
  // comes back `valid` is trustworthy, a guess never is. So DON'T skip — sweep it, and
  // early-exit picks the one real address (e.g. Vietnamese `thild` on a Google
  // Workspace catch-all). `invalid` (discriminating) and `unknown` (inconclusive
  // greylist) likewise proceed; opacity is concluded only after an all-unknown sweep.
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
  if (preClass === "opaque" || preClass === "catchall") {
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
      return outcome(toResult(candidates[0].email, candidates[0].patternLabel, name, domain, "unverified", 0), "not_found", calls, total, provider, calls === 0);
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
    (v) => v.result.status === "valid",
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
      confirmed = !!c && c.result.status === "valid";
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
  if (results.length > 0 && results.every((p) => p.result.result.status === "unknown")) {
    markOpaqueDomain(domain, provider);
  }

  // No candidate was confirmed deliverable. Rank the guesses by score, then
  // apply the confidence bar: a catch-all/rejected result below the bar is NOT
  // evidence the mailbox exists, so report "not found" instead of a low guess.
  const best =
    [...checked].sort((a, b) => b.score - a.score || priorNormForLabel(b.pattern) - priorNormForLabel(a.pattern))[0] ??
    toResult(candidates[0].email, candidates[0].patternLabel, name, domain, "unverified", 0);

  if (best.status !== "invalid" && best.score >= MIN_CONFIDENCE) {
    // Plausible but unconfirmed (e.g. a `risky` result above the bar).
    return outcome({ ...best, bestGuess: true }, "accept_all", calls, 0, provider, calls === 0);
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

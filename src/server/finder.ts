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
  winningPattern: string; // pattern label that produced a confirmed mailbox
  at: number; // epoch ms
}

const DOMAIN_TTL_MS = Number(process.env.FINDER_DOMAIN_TTL_MS ?? 7 * 24 * 3600 * 1000);

/**
 * Confidence bar for reporting an email as found when the backend could NOT
 * confirm it as `valid`. Catch-all addresses score ~40-54, so with the default
 * (60) they fall below the bar and are reported as "not found" rather than a
 * misleading low-confidence guess. Tune with FINDER_MIN_SCORE.
 */
const MIN_CONFIDENCE = Number(process.env.FINDER_MIN_SCORE ?? 60);

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
  if (Date.now() - f.at > DOMAIN_TTL_MS) {
    cache().delete(domain);
    return undefined;
  }
  return f;
}

/** Learn a domain's winning pattern — from a REAL backend `valid` result only. */
function learnWinningPattern(domain: string, winningPattern: string, provider: "reacher" | "mock"): void {
  if (provider !== "reacher") return; // never cache facts derived from the mock fallback
  cache().set(domain, { winningPattern, at: Date.now() });
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
  provider: "reacher" | "mock",
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
      "mock",
      false,
    );
  }

  const total = candidates.length;
  const cached = getFacts(domain);
  let calls = 0; // real backend calls made (per-email cache hits don't count)
  let provider: "reacher" | "mock" = "mock";

  // Check the learned winning pattern first so a known-format domain confirms
  // on the first call - but every candidate stays eligible and live-checked.
  const ordered = [...candidates];
  if (cached?.winningPattern) {
    const i = ordered.findIndex((c) => c.patternLabel === cached.winningPattern);
    if (i > 0) ordered.unshift(ordered.splice(i, 1)[0]);
  }

  // Verify candidates, letting the backend's per-mailbox verdict decide. Stop
  // ONLY on a confirmed `valid` - a `catch_all` on one guess does not rule out
  // a real, verifiable mailbox on another pattern.
  const checked: FinderResult[] = [];
  for (const c of ordered) {
    const v = await cachedVerify(c.email);
    if (!v.cached) calls++;
    provider = v.provider;
    const r = v.result;
    const fr = toResult(c.email, c.patternLabel, name, domain, r.status, r.score);
    checked.push(fr);

    // No MX -> nothing on the domain is deliverable (verdict comes from BE).
    if (r.checks.mx === "fail") {
      return outcome({ ...fr, status: "invalid" }, "no_mx", calls, total - checked.length, provider, calls === 0);
    }
    // Confirmed deliverable mailbox -> this is the person's real email.
    if (r.status === "valid") {
      learnWinningPattern(domain, c.patternLabel, provider);
      return outcome({ ...fr, bestGuess: true }, "verified", calls, total - checked.length, provider, calls === 0);
    }
    // catch_all / invalid / risky / unknown -> record and keep looking.
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

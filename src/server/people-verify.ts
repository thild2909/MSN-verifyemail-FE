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
import { findPersonEmail } from "./finder";
import { llmFindEmailsViaCrawler } from "./crawler-client";
import type { FinderOutcome } from "@/lib/types";
import type { EmailVerification } from "@/lib/leads/collect-types";
import type { CollectedPerson } from "@/lib/leads/people-types";
import * as store from "./people-collect-store";

/** Persist after every person so the table can show results + in-flight spinners. */
const COMMIT_EVERY = 1;
/** Concurrent finder lookups; each does several backend calls, so keep it modest. */
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.PEOPLE_VERIFY_CONCURRENCY ?? 5), 10));

export interface VerifyPassResult {
  verified: number; // people whose email got a verdict this pass
  valid: number; // confirmed-deliverable
  found: number; // real emails DISCOVERED (upgraded from a guess)
  provider: "reacher" | "none";
}

type PersonPatch = Partial<
  Pick<CollectedPerson, "email" | "emailKind" | "emailVerification">
>;

const now = () => new Date().toISOString();

type VerifyOneResult = {
  patch: PersonPatch;
  valid: boolean;
  found: boolean;
  provider: "reacher";
  needsLlm?: boolean;
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

/** Verify one person, discovering the real email when we only have a guess. */
async function verifyOne(
  t: store.PersonVerifyTarget,
  opts: { skipLlm?: boolean } = {},
): Promise<VerifyOneResult> {
  const canFind = !!(t.firstName && t.lastName && t.domain);
  if (t.emailKind === "found" && t.email) {
    const v = await cachedVerify(t.email);
    const ev: EmailVerification = { email: v.result.email, status: v.result.status, score: v.result.score, provider: v.provider, verifiedAt: v.result.verifiedAt };
    return { patch: { emailVerification: ev }, valid: v.result.status === "valid", found: false, provider: v.provider };
  }

  if (canFind) {
    const outcome = await findPersonEmail({ firstName: t.firstName, lastName: t.lastName, domain: t.domain! });
    const res = patchFromFinder(outcome);
    if (res.found || outcome.state === "accept_all") return res;
    if (outcome.state === "no_mx") return res;
    if (opts.skipLlm) return { ...res, needsLlm: true };
    const llm = await fillWithLlmEmails([t]);
    return llm.get(t.personId) ?? res;
  }

  if (t.email) {
    const v = await cachedVerify(t.email);
    const ev: EmailVerification = { email: v.result.email, status: v.result.status, score: v.result.score, provider: v.provider, verifiedAt: v.result.verifiedAt };
    return { patch: { emailVerification: ev }, valid: v.result.status === "valid", found: false, provider: v.provider };
  }

  // No domain, no mailbox, or finder/LLM both empty — persist Not found so the
  // UI never offers "Access email" again for this row.
  return notFoundPatch("reacher");
}

async function fillWithLlmEmails(targets: store.PersonVerifyTarget[]): Promise<Map<string, VerifyOneResult>> {
  const out = new Map<string, VerifyOneResult>();
  if (targets.length === 0) return out;
  let resp: Awaited<ReturnType<typeof llmFindEmailsViaCrawler>>;
  try {
    resp = await llmFindEmailsViaCrawler(targets.map((t) => ({
      id: t.personId,
      name: t.name,
      company: t.company,
      domain: t.domain,
      title: t.title ?? null,
    })));
  } catch {
    return out;
  }
  if (!resp.configured) return out;

  const byId = new Map(targets.map((t) => [t.personId, t]));
  for (const r of resp.results) {
    if (!byId.has(r.id)) continue;
    let hit: VerifyOneResult | null = null;
    for (const email of r.emails) {
      try {
        const v = await cachedVerify(email);
        if (v.result.status === "valid") {
          hit = {
            patch: {
              email: { value: email, source: "llm", confidence: 80 },
              emailKind: "found",
              emailVerification: {
                email,
                status: "valid",
                score: v.result.score,
                provider: v.provider,
                verifiedAt: v.result.verifiedAt,
              },
            },
            valid: true,
            found: true,
            provider: v.provider,
          };
          break;
        }
      } catch {
        /* try next candidate */
      }
    }
    out.set(r.id, hit ?? notFoundPatch("reacher"));
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
function persistLookup(jobId: string, personId: string, res: VerifyOneResult): SinglePersonVerifyResult {
  store.updatePersonResolved(jobId, personId, res.patch);
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

  const apply = (t: store.PersonVerifyTarget, res: VerifyOneResult) => {
    store.updatePersonResolved(jobId, t.personId, res.patch);
    store.markPersonVerifying(jobId, t.personId, false);
    providers.add(res.provider);
    verified++;
    if (res.valid) valid++;
    if (res.found) found++;
    if (++sinceCommit >= COMMIT_EVERY) { sinceCommit = 0; store.commitVerification(jobId); }
  };

  let next = 0;
  async function worker() {
    while (next < targets.length) {
      const t = targets[next++];
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
        else if (res.needsLlm) pendingLlm.push(t);
        else apply(t, res);
      } finally {
        store.markPersonVerifying(jobId, t.personId, false);
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

    if (pendingLlm.length > 0) {
      store.setVerifyingPersonIds(jobId, pendingLlm.map((t) => t.personId));
      const llmHits = await fillWithLlmEmails(pendingLlm);
      for (const t of pendingLlm) {
        apply(t, llmHits.get(t.personId) ?? notFoundPatch("reacher"));
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

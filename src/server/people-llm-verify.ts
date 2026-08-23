/**
 * People LLM cross-check — Next.js ORCHESTRATION only. The DeepSeek call runs in
 * the crawler-service. We only forward LOW-confidence / weak-signal people
 * (missing LinkedIn or confidence below the bar) so high-precision LinkedIn
 * matches never burn tokens. Opt-in; verdicts cached per person.
 */
import "server-only";
import { llmVerifyPeopleViaCrawler, llmEnrichPeopleViaCrawler, resolvePersonViaCrawler, type PersonLlmRecord, type PeopleEnrichSeedRecord, type CrawledPerson, type LlmProposedPersonOut } from "./crawler-client";
import type { LlmVerdict } from "@/lib/leads/collect-types";
import type { PersonSeniority } from "@/lib/leads/people-types";
import * as store from "./people-collect-store";

export interface LlmPassResult {
  configured: boolean;
  checked: number;
  skipped: number;
  verified: number;
  mismatch: number;
  uncertain: number;
  corrected: number; // mismatched / LinkedIn-less rows re-resolved to the right profile
  cleared: number; // confirmed-wrong LinkedIn stripped (no correct profile found)
  tokens: number;
}

// Bound the correction re-resolves (each is a live /person crawl) so one click
// can't fan out unbounded. Reuses the exec-fill concurrency knob.
const FIX_MAX = Number(process.env.LLM_PEOPLE_FIX_MAX ?? 24);

export async function llmVerifyPeople(jobId: string, onlyUnverified = true): Promise<LlmPassResult> {
  const targets = store.llmTargets(jobId, onlyUnverified);
  const skipped = store.llmSkippedCount(jobId, onlyUnverified);
  if (targets.length === 0) return { configured: true, checked: 0, skipped, verified: 0, mismatch: 0, uncertain: 0, corrected: 0, cleared: 0, tokens: 0 };

  const records: PersonLlmRecord[] = targets.map((p) => ({
    id: p.id,
    name: p.name,
    title: p.title?.value ? String(p.title.value) : null,
    linkedin: p.linkedin?.value ? String(p.linkedin.value) : null,
    company: p.company,
    companyDomain: p.companyDomain ?? null,
  }));

  const resp = await llmVerifyPeopleViaCrawler(records);
  if (!resp.configured) return { configured: false, checked: 0, skipped: 0, verified: 0, mismatch: 0, uncertain: 0, corrected: 0, cleared: 0, tokens: 0 };

  const at = new Date().toISOString();
  let verified = 0, mismatch = 0, uncertain = 0;
  const verdictById = new Map<string, LlmVerdict>();
  for (const v of resp.verdicts) {
    const verdict: LlmVerdict = { status: v.status, confidence: v.confidence, reason: v.reason, model: resp.model, verifiedAt: at };
    verdictById.set(v.id, verdict);
    store.setPersonLlm(jobId, v.id, verdict);
    if (v.status === "verified") verified++; else if (v.status === "mismatch") mismatch++; else uncertain++;
  }

  // CORRECTION PASS — a "mismatch" verdict (the stored LinkedIn belongs to someone
  // else / another company, e.g. "…indicates a LinkedIn employee, not SAKSOFT") or
  // a row with NO LinkedIn must be RE-RESOLVED to the correct profile, not left
  // wrong. Re-run the live /person crawl by name+company; on a confident match,
  // replace linkedin/title/seniority. If a confirmed-mismatch can't be re-resolved,
  // strip the wrong LinkedIn so a bad link is never shown. Bounded by FIX_MAX.
  const norm = (u: string) => u.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  const needFix = targets
    .filter((p) => !(p.linkedin && p.linkedin.value) || verdictById.get(p.id)?.status === "mismatch")
    .slice(0, FIX_MAX);
  let corrected = 0, cleared = 0;

  await pooled(
    needFix.map((p) => async () => {
      const { firstName, lastName } = splitName(p.name);
      if (!firstName && !p.firstName) return;
      const wasMismatch = verdictById.get(p.id)?.status === "mismatch";
      const oldLi = p.linkedin?.value ? norm(String(p.linkedin.value)) : "";
      try {
        // Re-resolve WITHOUT passing the (wrong) linkedin, so the crawl finds the
        // real profile by name + company rather than re-confirming the bad one.
        const r = await resolvePersonViaCrawler({
          company: p.company,
          firstName: p.firstName || firstName,
          lastName: p.lastName || lastName,
          location: p.location ?? "",
          domain: p.companyDomain ?? undefined,
        });
        const newLi = r.matched && r.person.linkedin?.value ? String(r.person.linkedin.value) : "";
        if (newLi) {
          // Fill EVERYTHING the re-resolve found for the correct profile, not just
          // the link: title, seniority, location, and a fresh email. If the email
          // changed, drop the stale deliverability check so it re-verifies.
          const emailChanged = (r.person.email?.value ?? "") !== (p.email?.value ?? "");
          store.updatePersonResolved(jobId, p.id, {
            linkedin: r.person.linkedin,
            title: r.person.title ?? p.title,
            seniority: r.person.seniority,
            location: r.person.location ?? p.location,
            email: r.person.email ?? p.email,
            emailKind: r.person.email ? r.person.emailKind : p.emailKind,
            ...(emailChanged ? { emailVerification: null } : {}),
            confidence: Math.max(p.confidence, r.person.confidence),
            collection: [
              ...(p.collection ?? []),
              { source: "search", status: "ok", proxy: null, ms: 0, fieldsFound: 1, detail: "ai-verify-correction", provider: "deepseek" },
            ],
          });
          const changed = oldLi && norm(newLi) !== oldLi;
          store.setPersonLlm(jobId, p.id, {
            status: "verified",
            confidence: Math.max(80, r.person.confidence),
            reason: changed
              ? `Corrected: re-resolved to the ${p.company} profile (${norm(newLi)}).`
              : `Re-resolved and confirmed at ${p.company}.`,
            model: resp.model,
            verifiedAt: at,
          });
          corrected++;
          if (wasMismatch) mismatch--;
          verified++;
        } else if (wasMismatch && oldLi) {
          store.updatePersonResolved(jobId, p.id, { linkedin: null });
          store.setPersonLlm(jobId, p.id, {
            status: "mismatch",
            confidence: verdictById.get(p.id)?.confidence ?? 60,
            reason: `Removed wrong LinkedIn — no ${p.company} profile found on the live web.`,
            model: resp.model,
            verifiedAt: at,
          });
          cleared++;
        }
      } catch {
        /* best-effort — leave the original verdict in place */
      }
    }),
    VERIFY_CONCURRENCY,
  );

  // A correction can resolve a slug-less row to a LinkedIn that another row already
  // has → collapse any duplicates it created.
  if (corrected > 0) store.dedupePeople(jobId);
  store.commitLlm(jobId);
  return { configured: true, checked: resp.verdicts.length, skipped, verified, mismatch, uncertain, corrected, cleared, tokens: resp.tokens };
}

/* --------------------- AI exec-fill for coverage gaps -------------------- */

export interface LlmEnrichPeopleResult {
  configured: boolean;
  companies: number; // coverage-gap companies sent to the LLM
  proposed: number; // candidate executives the LLM returned
  verified: number; // candidates inserted (crawl-confirmed or AI knowledge-fill)
  dropped: number; // candidates below confidence / no usable name
  tokens: number;
}

// Cap the (expensive) per-candidate re-verification so one AI-verify click can't
// fan out unbounded. Tunable via env; safe defaults keep a click bounded.
const VERIFY_MAX = Number(process.env.LLM_PEOPLE_VERIFY_MAX ?? 24);
const VERIFY_CONCURRENCY = Number(process.env.LLM_PEOPLE_VERIFY_CONCURRENCY ?? 3);

/** Run tasks with a small concurrency cap, preserving nothing but completion. */
async function pooled<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const out: T[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      out[idx] = await tasks[idx]();
    }
  });
  await Promise.all(workers);
  return out;
}

const splitName = (full: string): { firstName: string; lastName: string } => {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
};

/**
 * DeepSeek exec-fill for coverage-gap companies (discover-mode seeds the crawl
 * found NOBODY at). The LLM proposes founders/directors/C-level from its own
 * knowledge; we then try a live `/person` crawl to attach LinkedIn/email when
 * possible. Candidates that the crawl cannot confirm are STILL inserted as
 * AI-sourced rows (the crawl already failed for these firms — requiring a
 * second crawl match left 161 gaps empty). `onlyUnattempted` skips seeds
 * already AI-filled.
 */
export async function llmEnrichPeople(jobId: string, onlyUnattempted = true): Promise<LlmEnrichPeopleResult> {
  const targets = store.peopleEnrichTargets(jobId, onlyUnattempted);
  if (targets.length === 0) return { configured: true, companies: 0, proposed: 0, verified: 0, dropped: 0, tokens: 0 };

  const records: PeopleEnrichSeedRecord[] = targets.map(({ index, seed }) => ({
    id: String(index),
    name: seed.company,
    location: seed.location ?? null,
    website: seed.website ?? seed.domain ?? null,
    linkedin: seed.linkedin ?? null,
  }));

  const resp = await llmEnrichPeopleViaCrawler(records);
  if (!resp.configured) return { configured: false, companies: 0, proposed: 0, verified: 0, dropped: 0, tokens: 0 };

  const byIndex = new Map(targets.map((t) => [String(t.index), t]));
  let proposed = 0, verified = 0, dropped = 0;
  let crawlBudget = VERIFY_MAX;
  const at = new Date().toISOString();

  for (const result of resp.results) {
    const target = byIndex.get(result.id);
    if (!target) continue;
    const { index, seed } = target;
    proposed += result.people.length;

    const crawlN = Math.min(crawlBudget, result.people.length);
    crawlBudget -= crawlN;

    const inserted = (
      await pooled(
        result.people.map((cand, i) => async (): Promise<CrawledPerson | null> => {
          const { firstName, lastName } = splitName(cand.name);
          if (!firstName) return null;
          if (i < crawlN) {
            try {
              const r = await resolvePersonViaCrawler({
                company: seed.company,
                firstName,
                lastName,
                location: seed.location ?? "",
                domain: seed.domain ?? undefined,
                website: seed.website ?? undefined,
                linkedin: seed.linkedin ?? undefined,
              });
              if (r.matched) {
                const person = { ...r.person };
                if ((!person.title || !person.title.value) && cand.title) {
                  person.title = { value: cand.title, source: "llm", confidence: cand.confidence };
                }
                person.collection = [
                  ...(person.collection ?? []),
                  { source: "llm", status: "ok", proxy: null, ms: 0, fieldsFound: 1, detail: `ai-fill${cand.source ? ` · ${cand.source}` : ""}`, provider: "deepseek" },
                ];
                return person;
              }
            } catch {
              /* crawl failed — fall through to knowledge-fill */
            }
          }
          if (cand.confidence < LLM_INSERT_MIN) return null;
          return personFromLlm(cand, seed, resp.model, at);
        }),
        VERIFY_CONCURRENCY,
      )
    ).filter((p): p is CrawledPerson => p != null);

    if (inserted.length > 0) store.applyLlmPeople(jobId, index, inserted);
    else store.markSeedLlmEnriched(jobId, index);
    verified += inserted.length;
    dropped += result.people.length - inserted.length;
  }

  store.commitVerification(jobId); // recompute summary + persist
  return { configured: true, companies: targets.length, proposed, verified, dropped, tokens: resp.tokens };
}

const LLM_INSERT_MIN = Number(process.env.LLM_PEOPLE_INSERT_MIN_CONF ?? 35);

function seniorityFromTitle(title: string): PersonSeniority {
  const t = title.toLowerCase();
  if (/\b(co-?founder|founder|owner)\b/.test(t)) return "founder";
  if (/\b(chief|\bceo\b|\bcto\b|\bcfo\b|\bcoo\b|\bcmo\b|\bcio\b|\bcpo\b|\bciso\b|\bcdo\b|managing director|\bmd\b|\bdirector\b)\b/.test(t)) return "c_level";
  if (/\bpresident\b/.test(t)) return "president";
  if (/\b(vice[- ]president|\bvp\b|svp|evp)\b/.test(t)) return "vp";
  return "other";
}

function cleanLinkedin(v?: string | null): string | null {
  if (!v) return null;
  const s = v.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
  return /linkedin\.com\/in\//i.test(s) ? s : null;
}

function personFromLlm(
  cand: LlmProposedPersonOut,
  seed: { company: string; location?: string; domain?: string | null },
  model: string,
  at: string,
): CrawledPerson {
  const { firstName, lastName } = splitName(cand.name);
  const li = cleanLinkedin(cand.linkedin);
  const confidence = Math.min(75, Math.max(40, cand.confidence || 50));
  return {
    company: seed.company,
    companyDomain: seed.domain ?? null,
    name: cand.name.trim(),
    firstName,
    lastName,
    title: { value: cand.title, source: "llm", confidence },
    seniority: seniorityFromTitle(cand.title),
    linkedin: li ? { value: li, source: "llm", confidence } : null,
    email: null,
    emailKind: "none",
    location: seed.location ?? null,
    confidence,
    emailVerification: null,
    llmVerification: {
      status: "verified",
      confidence,
      reason: `AI knowledge-fill: ${cand.title} at ${seed.company}.`,
      model,
      verifiedAt: at,
    },
    collection: [
      {
        source: "llm",
        status: "ok",
        proxy: null,
        ms: 0,
        fieldsFound: 1,
        detail: `ai-fill${cand.source ? ` · ${cand.source}` : ""}`,
        provider: "deepseek",
      },
    ],
  };
}

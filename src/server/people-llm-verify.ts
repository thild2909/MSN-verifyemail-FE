/**
 * People LLM cross-check — Next.js ORCHESTRATION only. The DeepSeek call runs in
 * the crawler-service. We only forward LOW-confidence / weak-signal people
 * (missing LinkedIn or confidence below the bar) so high-precision LinkedIn
 * matches never burn tokens. Opt-in; verdicts cached per person.
 */
import "server-only";
import { llmVerifyPeopleViaCrawler, type PersonLlmRecord } from "./crawler-client";
import type { LlmVerdict } from "@/lib/leads/collect-types";
import * as store from "./people-collect-store";

export interface LlmPassResult {
  configured: boolean;
  checked: number;
  skipped: number;
  verified: number;
  mismatch: number;
  uncertain: number;
  tokens: number;
}

export async function llmVerifyPeople(jobId: string, onlyUnverified = true): Promise<LlmPassResult> {
  const targets = store.llmTargets(jobId, onlyUnverified);
  const skipped = store.llmSkippedCount(jobId, onlyUnverified);
  if (targets.length === 0) return { configured: true, checked: 0, skipped, verified: 0, mismatch: 0, uncertain: 0, tokens: 0 };

  const records: PersonLlmRecord[] = targets.map((p) => ({
    id: p.id,
    name: p.name,
    title: p.title?.value ? String(p.title.value) : null,
    linkedin: p.linkedin?.value ? String(p.linkedin.value) : null,
    company: p.company,
    companyDomain: p.companyDomain ?? null,
  }));

  const resp = await llmVerifyPeopleViaCrawler(records);
  if (!resp.configured) return { configured: false, checked: 0, skipped: 0, verified: 0, mismatch: 0, uncertain: 0, tokens: 0 };

  const at = new Date().toISOString();
  let verified = 0, mismatch = 0, uncertain = 0;
  for (const v of resp.verdicts) {
    const verdict: LlmVerdict = { status: v.status, confidence: v.confidence, reason: v.reason, model: resp.model, verifiedAt: at };
    store.setPersonLlm(jobId, v.id, verdict);
    if (v.status === "verified") verified++; else if (v.status === "mismatch") mismatch++; else uncertain++;
  }
  store.commitLlm(jobId);
  return { configured: true, checked: resp.verdicts.length, skipped, verified, mismatch, uncertain, tokens: resp.tokens };
}

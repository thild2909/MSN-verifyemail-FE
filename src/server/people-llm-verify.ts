/**
 * People LLM cross-check — Next.js ORCHESTRATION only. The DeepSeek call runs in
 * the crawler-service (backend crawl). Here we gather the store's unchecked
 * people → forward to the crawler-service → write verdicts back. Opt-in; cached.
 */
import "server-only";
import { llmVerifyPeopleViaCrawler, type PersonLlmRecord } from "./crawler-client";
import type { LlmVerdict } from "@/lib/leads/collect-types";
import * as store from "./people-collect-store";

export interface LlmPassResult {
  configured: boolean;
  checked: number;
  verified: number;
  mismatch: number;
  uncertain: number;
  tokens: number;
}

export async function llmVerifyPeople(jobId: string, onlyUnverified = true): Promise<LlmPassResult> {
  const targets = store.llmTargets(jobId, onlyUnverified);
  if (targets.length === 0) return { configured: true, checked: 0, verified: 0, mismatch: 0, uncertain: 0, tokens: 0 };

  const records: PersonLlmRecord[] = targets.map((p) => ({
    id: p.id,
    name: p.name,
    title: p.title?.value ? String(p.title.value) : null,
    linkedin: p.linkedin?.value ? String(p.linkedin.value) : null,
    company: p.company,
    companyDomain: p.companyDomain ?? null,
  }));

  const resp = await llmVerifyPeopleViaCrawler(records);
  if (!resp.configured) return { configured: false, checked: 0, verified: 0, mismatch: 0, uncertain: 0, tokens: 0 };

  const at = new Date().toISOString();
  let verified = 0, mismatch = 0, uncertain = 0;
  for (const v of resp.verdicts) {
    const verdict: LlmVerdict = { status: v.status, confidence: v.confidence, reason: v.reason, model: resp.model, verifiedAt: at };
    store.setPersonLlm(jobId, v.id, verdict);
    if (v.status === "verified") verified++; else if (v.status === "mismatch") mismatch++; else uncertain++;
  }
  store.commitLlm(jobId);
  return { configured: true, checked: resp.verdicts.length, verified, mismatch, uncertain, tokens: resp.tokens };
}

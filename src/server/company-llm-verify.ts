/**
 * Company LLM cross-check — Next.js ORCHESTRATION only. The actual DeepSeek call
 * lives in the crawler-service (backend crawl). Here we: gather the store's
 * low-confidence / uncertain companies → forward them to the crawler-service →
 * write the returned verdicts back. High-confidence rows skip the LLM (tokens).
 * Opt-in; verdicts are cached per record.
 */
import "server-only";
import { llmVerifyCompaniesViaCrawler, llmEnrichCompaniesViaCrawler, type CompanyLlmRecord, type CompanySeedRecord } from "./crawler-client";
import type { LlmVerdict } from "@/lib/leads/collect-types";
import * as store from "./company-collect-store";

export interface LlmPassResult {
  configured: boolean;
  checked: number;
  skipped: number; // high-confidence rows that did not call the LLM
  verified: number;
  mismatch: number;
  uncertain: number;
  tokens: number;
}

export async function llmVerifyCompanies(jobId: string, onlyUnverified = true): Promise<LlmPassResult> {
  const targets = store.llmTargets(jobId, onlyUnverified);
  const skipped = store.llmSkippedCount(jobId, onlyUnverified);
  if (targets.length === 0) return { configured: true, checked: 0, skipped, verified: 0, mismatch: 0, uncertain: 0, tokens: 0 };

  const records: CompanyLlmRecord[] = targets.map((c) => ({
    id: c.id,
    name: c.inputName,
    website: c.website?.value ? String(c.website.value) : c.domainGuess || null,
    linkedin: c.linkedin?.value ? String(c.linkedin.value) : null,
    industry: c.industry?.value ? String(c.industry.value) : null,
    location: c.address?.value ? String(c.address.value) : c.inputLocation || null,
    employees: c.employees?.value ? String(c.employees.value) : null,
  }));

  const resp = await llmVerifyCompaniesViaCrawler(records);
  if (!resp.configured) return { configured: false, checked: 0, skipped: 0, verified: 0, mismatch: 0, uncertain: 0, tokens: 0 };

  const at = new Date().toISOString();
  let verified = 0, mismatch = 0, uncertain = 0;
  for (const v of resp.verdicts) {
    const verdict: LlmVerdict = { status: v.status, confidence: v.confidence, reason: v.reason, suggestion: v.suggestion, model: resp.model, verifiedAt: at };
    store.setCompanyLlm(jobId, v.id, verdict);
    if (v.status === "verified") verified++; else if (v.status === "mismatch") mismatch++; else uncertain++;
  }
  store.commitLlm(jobId);
  return { configured: true, checked: resp.verdicts.length, skipped, verified, mismatch, uncertain, tokens: resp.tokens };
}

export interface LlmEnrichResult {
  configured: boolean;
  targeted: number; // failed / not-found rows sent to the LLM
  filled: number; // rows the LLM knew and filled in
  notFound: number; // rows the LLM had no reliable data for
  tokens: number;
}

/**
 * DeepSeek knowledge-fill for the rows the crawler could NOT resolve
 * (status failed / not_found). One merged prompt per batch → tokens saved.
 * `onlyUnattempted` skips rows already tried by the LLM. Fills fields with
 * source "llm" and promotes filled rows to "enriched".
 */
export async function llmEnrichCompanies(jobId: string, onlyUnattempted = true): Promise<LlmEnrichResult> {
  const targets = store.llmEnrichTargets(jobId, onlyUnattempted);
  if (targets.length === 0) return { configured: true, targeted: 0, filled: 0, notFound: 0, tokens: 0 };

  const records: CompanySeedRecord[] = targets.map((c) => ({
    id: c.id,
    name: c.inputName,
    location: c.inputLocation || null,
  }));

  const resp = await llmEnrichCompaniesViaCrawler(records);
  if (!resp.configured) return { configured: false, targeted: 0, filled: 0, notFound: 0, tokens: 0 };

  const at = new Date().toISOString();
  let filled = 0;
  for (const e of resp.enrichments) {
    if (store.applyLlmEnrichment(jobId, e, resp.model, at)) filled++;
  }
  store.commitVerification(jobId); // recompute summary (enriched/website counts) + persist
  return { configured: true, targeted: resp.enrichments.length, filled, notFound: resp.enrichments.length - filled, tokens: resp.tokens };
}

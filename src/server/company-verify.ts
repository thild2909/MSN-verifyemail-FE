/**
 * Email-verification pass for a company collection job.
 *
 * After collection, every REAL (website-sourced) contact email is checked for
 * deliverability through the `check-if-email-exists` backend via its batch
 * endpoint (`/v1/check_email_batch`). There is no mock fallback: if the engine
 * is unreachable the pass fails with a real error rather than fabricating
 * verdicts. Shared by the automatic post-collection pass (`company-collect-job`)
 * and the manual "Verify emails" action (API route).
 */
import "server-only";
import { verifyEmailsBatch, VerifierUnavailableError } from "@/lib/verifier/backend";
import type { EmailVerification } from "@/lib/leads/collect-types";
import * as store from "./company-collect-store";

const BATCH_SIZE = 100; // matches the backend's MAX_BATCH

export interface VerifyPassResult {
  verified: number;
  valid: number;
  provider: "reacher" | "none";
}

export async function verifyCollectedEmails(jobId: string, onlyUnverified = true): Promise<VerifyPassResult> {
  const targets = store.emailTargets(jobId, onlyUnverified);
  if (targets.length === 0) {
    store.setJobVerifyStatus(jobId, "done");
    return { verified: 0, valid: 0, provider: "none" };
  }

  store.setJobVerifyStatus(jobId, "verifying");

  let verified = 0;
  let valid = 0;

  try {
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const chunk = targets.slice(i, i + BATCH_SIZE);
      const outcomes = await verifyEmailsBatch(chunk.map((t) => t.email));
      chunk.forEach((t, j) => {
        const o = outcomes[j];
        if (!o) return;
        const ev: EmailVerification = {
          email: o.result.email,
          status: o.result.status,
          score: o.result.score,
          provider: o.provider,
          verifiedAt: o.result.verifiedAt,
        };
        store.setCompanyVerification(jobId, t.companyId, ev);
        verified++;
        if (ev.status === "valid") valid++;
      });
      store.commitVerification(jobId); // persist + refresh summary after each chunk
    }
  } catch (e) {
    if (e instanceof VerifierUnavailableError) {
      // Persist partial progress, reset to idle so it can be retried, and
      // surface the error — never mark the pass "done" on an engine outage.
      store.commitVerification(jobId);
      store.setJobVerifyStatus(jobId, "idle");
    }
    throw e;
  }

  store.setJobVerifyStatus(jobId, "done");
  return { verified, valid, provider: "reacher" };
}

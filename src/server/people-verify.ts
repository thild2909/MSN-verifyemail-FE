/**
 * Email-verification pass for a people-collection job. Checks each person's
 * email (pattern-guessed or found) for deliverability through the
 * `check-if-email-exists` backend, with a graceful mock fallback. Verifying the
 * guessed first.last@domain pattern is the whole point — it confirms which
 * guesses are real deliverable inboxes. Mirrors company-verify.
 */
import "server-only";
import { verifyEmailsBatch } from "@/lib/verifier/backend";
import type { EmailVerification } from "@/lib/leads/collect-types";
import * as store from "./people-collect-store";

const BATCH_SIZE = 100;

export interface VerifyPassResult {
  verified: number;
  valid: number;
  provider: "reacher" | "mock" | "mixed" | "none";
}

export async function verifyCollectedPeople(jobId: string, onlyUnverified = true): Promise<VerifyPassResult> {
  const targets = store.emailTargets(jobId, onlyUnverified);
  if (targets.length === 0) {
    store.setJobVerifyStatus(jobId, "done");
    return { verified: 0, valid: 0, provider: "none" };
  }

  store.setJobVerifyStatus(jobId, "verifying");

  let verified = 0;
  let valid = 0;
  const providers = new Set<"reacher" | "mock">();

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const chunk = targets.slice(i, i + BATCH_SIZE);
    const outcomes = await verifyEmailsBatch(chunk.map((t) => t.email));
    chunk.forEach((t, j) => {
      const o = outcomes[j];
      if (!o) return;
      providers.add(o.provider);
      const ev: EmailVerification = {
        email: o.result.email,
        status: o.result.status,
        score: o.result.score,
        provider: o.provider,
        verifiedAt: o.result.verifiedAt,
      };
      store.setPersonVerification(jobId, t.personId, ev);
      verified++;
      if (ev.status === "valid") valid++;
    });
    store.commitVerification(jobId);
  }

  store.setJobVerifyStatus(jobId, "done");
  const provider = providers.size === 2 ? "mixed" : providers.has("reacher") ? "reacher" : "mock";
  return { verified, valid, provider };
}

/**
 * Background verification job runner (server-side).
 *
 * Started fire-and-forget from the POST /api/v1/lists handler. It walks a
 * list's un-verified records, checks each email through the Rust engine
 * (`verifyWithBackend`) with a bounded worker pool, and writes results back
 * into the store as they arrive — so GET /api/v1/lists/:id reflects live
 * progress. The Next.js Node server keeps the promise alive after the
 * response is sent.
 */
import "server-only";
import { verifyWithBackend } from "@/lib/verifier/backend";
import * as store from "./store";

const CONCURRENCY = Number(process.env.APP_JOB_CONCURRENCY ?? 6);
const running = new Set<string>();

export function startJob(listId: string) {
  if (running.has(listId)) return;
  running.add(listId);
  void run(listId).finally(() => running.delete(listId));
}

export function isRunning(listId: string) {
  return running.has(listId);
}

async function run(listId: string) {
  const pending = store.rawRecords(listId).filter((r) => !r.result);
  let next = 0;

  async function worker() {
    while (next < pending.length) {
      const rec = pending[next++];
      try {
        const { result } = await verifyWithBackend(rec.email);
        store.applyResult(listId, rec.id, result);
      } catch {
        // Leave unresolved records; finalize marks the list complete anyway.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length || 1) }, () => worker()));
  store.finalizeList(listId);
}

/**
 * Server-side verification cache (P3).
 *
 * Wraps the backend verifier with a per-email result cache so the same address
 * isn't re-checked over its TTL — the way finder providers cache deliverability
 * for days. Only *confident* results from the real engine are cached; mock
 * results (backend offline) are never cached because they're non-deterministic
 * and would poison the cache with fake verdicts.
 */
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { verifyWithBackend, type VerifyOutcome } from "@/lib/verifier/backend";
import { isM365Domain, m365MailboxExists } from "@/lib/verifier/m365";
import type { VerificationStatus } from "@/lib/types";

interface CachedEntry {
  outcome: VerifyOutcome;
  at: number; // epoch ms
}

/** Default 14 days — inside the common 7–30 day window used by providers. */
const EMAIL_TTL_MS = Number(process.env.VERIFY_CACHE_TTL_MS ?? 14 * 24 * 3600 * 1000);

/**
 * Only DEFINITIVE verdicts are safe to cache. `unknown` / `risky` are transient
 * (greylisting, temporary SMTP failures, rate limits) and a retry can resolve
 * them to a real answer — caching them would freeze a false negative for days.
 */
const CACHEABLE_STATUS = new Set<VerificationStatus>([
  "valid",
  "invalid",
  "catch_all",
  "disposable",
  "role",
]);
/**
 * A non-definitive engine answer (`risky` / `unknown` that is NOT our own timeout)
 * is kept for a SHORT window only. Within one Find & verify pass the same address
 * is otherwise re-checked by several layers (L1 → L4 → L3 re-run → L5) and again by
 * every retry round — each costing a full ~10s SMTP probe — which is a large part of
 * why hard rows never finished. Short enough that a later pass still re-asks.
 */
const TRANSIENT_TTL_MS = Number(process.env.VERIFY_TRANSIENT_TTL_MS ?? 45 * 60 * 1000);
const TRANSIENT_STATUS = new Set<VerificationStatus>(["risky", "unknown"]);
function servable(hit: CachedEntry): boolean {
  const age = Date.now() - hit.at;
  const st = hit.outcome.result.status;
  if (CACHEABLE_STATUS.has(st)) return age <= EMAIL_TTL_MS;
  return TRANSIENT_STATUS.has(st) && !hit.outcome.timedOut && age <= TRANSIENT_TTL_MS;
}

declare global {
  // eslint-disable-next-line no-var
  var __verifyCache: Map<string, CachedEntry> | undefined;
}

function cache(): Map<string, CachedEntry> {
  if (!globalThis.__verifyCache) globalThis.__verifyCache = new Map();
  return globalThis.__verifyCache;
}

/**
 * GLOBAL cap on concurrent backend SMTP checks. Row/candidate parallelism in the
 * People pass and the finder can otherwise fan out to dozens of simultaneous
 * `check_email` calls, which floods the Rust engine (reacher) — it then returns
 * 429/503 or drops connections, surfacing as `VerifierUnavailableError` that
 * aborts the whole pass. This semaphore bounds TOTAL in-flight SMTP regardless of
 * how many callers run, so the engine stays healthy. Tune with VERIFY_SMTP_CONCURRENCY.
 */
const SMTP_MAX = Math.max(1, Math.min(Number(process.env.VERIFY_SMTP_CONCURRENCY ?? 10), 32));

/**
 * Per-row execution context for the People pass (AsyncLocalStorage, so it follows
 * the row through every layer without threading a parameter). It lets the pass:
 *  - CANCEL a row that ran past its deadline. Before this, `Promise.race` only
 *    stopped WAITING for the row — its layers kept running in the background and
 *    kept taking SMTP slots, so every timed-out row became a zombie that starved
 *    the next rows, which then timed out too (the "hang" cascade on big lists).
 *  - measure how long the row was STALLED waiting for an SMTP slot, so the hard
 *    deadline counts the row's own work, not queueing behind other rows/jobs.
 */
export interface RowContext {
  cancelled: boolean;
  active: number; // SMTP slots this row currently holds
  waiting: number; // SMTP slot requests this row has queued
  stalledMs: number; // accumulated time with waiting > 0 and active === 0
  stallSince: number | null;
  phase: string; // pipeline layer the row is in (diagnostics: where rows spend time)
}
/** Record which layer the current row is in (no-op outside a row). */
export function setRowPhase(phase: string): void {
  const ctx = rowStore().getStore();
  if (ctx) ctx.phase = phase;
}
export class RowCancelledError extends Error {
  constructor() {
    super("row cancelled (deadline)");
    this.name = "RowCancelledError";
  }
}
declare global {
  // eslint-disable-next-line no-var
  var __verifyRowCtx: AsyncLocalStorage<RowContext> | undefined;
}
function rowStore(): AsyncLocalStorage<RowContext> {
  if (!globalThis.__verifyRowCtx) globalThis.__verifyRowCtx = new AsyncLocalStorage<RowContext>();
  return globalThis.__verifyRowCtx;
}
export function newRowContext(): RowContext {
  return { cancelled: false, active: 0, waiting: 0, stalledMs: 0, stallSince: null, phase: "start" };
}
/** Run `fn` with `ctx` as the current row context (see RowContext). */
export function runInRowContext<T>(ctx: RowContext, fn: () => Promise<T>): Promise<T> {
  return rowStore().run(ctx, fn);
}
/** True when the current async context belongs to a row that was cancelled. */
export function currentRowCancelled(): boolean {
  return rowStore().getStore()?.cancelled === true;
}
/** Time this row has spent stalled on the SMTP gate so far (ms). */
export function rowStalledMs(ctx: RowContext): number {
  return ctx.stalledMs + (ctx.stallSince !== null ? Date.now() - ctx.stallSince : 0);
}
function updateStall(ctx: RowContext) {
  const stalled = ctx.waiting > 0 && ctx.active === 0;
  if (stalled && ctx.stallSince === null) ctx.stallSince = Date.now();
  else if (!stalled && ctx.stallSince !== null) {
    ctx.stalledMs += Date.now() - ctx.stallSince;
    ctx.stallSince = null;
  }
}

interface SmtpWaiter { wake: () => void; cancel: () => void; ctx: RowContext | undefined }
declare global {
  // eslint-disable-next-line no-var
  var __verifySmtpGate: { active: number; queue: SmtpWaiter[] } | undefined;
}
function gate() {
  if (!globalThis.__verifySmtpGate) globalThis.__verifySmtpGate = { active: 0, queue: [] };
  return globalThis.__verifySmtpGate;
}
/** Hand a freed slot to the next waiter whose row is still alive; else free it. */
function releaseSlot() {
  const g = gate();
  for (;;) {
    const next = g.queue.shift();
    if (!next) { g.active--; return; }
    if (next.ctx?.cancelled) { next.cancel(); continue; } // dead row: skip, never burn a slot on it
    next.wake(); // hand our slot directly to a waiter (count unchanged)
    return;
  }
}
/**
 * Acquire one SMTP slot, run `fn`, release. Correct hand-off semaphore: a waiter
 * is woken by INHERITING the finisher's slot (the releaser does NOT decrement and
 * the woken waiter does NOT re-increment), so `active` can never exceed SMTP_MAX.
 * A cancelled row (past its deadline) is refused a slot — both at request time and
 * when it reaches the head of the queue — so abandoned work never occupies the
 * engine.
 */
async function withSmtpSlot<T>(fn: () => Promise<T>): Promise<T> {
  const g = gate();
  const ctx = rowStore().getStore();
  if (ctx?.cancelled) throw new RowCancelledError();
  if (g.active >= SMTP_MAX) {
    // Full: wait to be handed a slot. We do NOT increment on wake — we inherit
    // the releasing task's slot (it also skips the decrement), keeping the count.
    if (ctx) { ctx.waiting++; updateStall(ctx); }
    try {
      await new Promise<void>((wake, reject) => g.queue.push({ wake, cancel: () => reject(new RowCancelledError()), ctx }));
    } finally {
      if (ctx) { ctx.waiting--; updateStall(ctx); }
    }
  } else {
    g.active++;
  }
  if (ctx) { ctx.active++; updateStall(ctx); }
  try {
    return await fn();
  } finally {
    if (ctx) { ctx.active--; updateStall(ctx); }
    releaseSlot();
  }
}

/** Live SMTP gate occupancy (diagnostics). */
export function smtpGateStats(): { active: number; queued: number; max: number } {
  const g = gate();
  return { active: g.active, queued: g.queue.length, max: SMTP_MAX };
}

export interface CachedVerifyOutcome extends VerifyOutcome {
  /** True when served from cache (no backend call was made). */
  cached: boolean;
}

/**
 * Verify one email, using the cache unless `fresh` is requested. Returns the
 * outcome plus whether it was a cache hit so callers can meter real backend use.
 */
export async function cachedVerify(
  email: string,
  opts: { fresh?: boolean; timeoutMs?: number } = {},
): Promise<CachedVerifyOutcome> {
  const key = email.trim().toLowerCase();
  // A row past its deadline stops here: its result would be discarded anyway.
  if (rowStore().getStore()?.cancelled) throw new RowCancelledError();

  if (!opts.fresh) {
    const hit = cache().get(key);
    // Serve fresh DEFINITIVE verdicts, and a non-definitive one only inside its short
    // window (see TRANSIENT_TTL_MS). Anything older is dropped and re-verified.
    if (hit && servable(hit)) {
      return { ...hit.outcome, cached: true };
    }
    if (hit) cache().delete(key);
  }

  const outcome = await m365Confirmed(await withSmtpSlot(() => verifyWithBackend(email, { timeoutMs: opts.timeoutMs })), email);
  // Persist only real engine results — never mock fallbacks or our own timeouts;
  // unknown/risky are served back only within TRANSIENT_TTL_MS (servable()).
  const st = outcome.result.status;
  // A greylisted answer is expected to change on a retry, so it is never held.
  const transientOk = TRANSIENT_STATUS.has(st) && !outcome.result.checks.greylisted;
  if (outcome.provider === "reacher" && !outcome.timedOut && (CACHEABLE_STATUS.has(st) || transientOk)) {
    cache().set(key, { outcome, at: Date.now() });
  }
  return { ...outcome, cached: false };
}

/**
 * M365 rescue: the Rust engine can't SMTP-verify Microsoft 365 mailboxes and
 * returns `unknown`/`catch_all`/`invalid` for real, deliverable addresses. When
 * the domain is M365 and the verdict is not already `valid`, confirm the mailbox
 * out-of-band via GetCredentialType (see `@/lib/verifier/m365`). A confirmed
 * mailbox is upgraded to `valid`; anything ambiguous is left exactly as the
 * engine returned it. Only ever upgrades — never downgrades a real verdict.
 */
async function m365Confirmed(outcome: VerifyOutcome, email: string): Promise<VerifyOutcome> {
  const r = outcome.result;
  if (r.status === "valid" || r.status === "disposable" || !isM365Domain(r.mxRecords)) return outcome;
  try {
    if ((await m365MailboxExists(email)) !== "exists") return outcome;
  } catch {
    return outcome;
  }
  return {
    ...outcome,
    result: {
      ...r,
      status: "valid",
      score: Math.max(r.score, 90),
      suggestedAction: "Safe to send: Microsoft 365 confirms this mailbox exists.",
      checks: { ...r.checks, mailbox: "pass" },
      // GetCredentialType answered for THIS exact account on a tenant proven to
      // discriminate — a per-address observation, so trustedValid accepts it even
      // when a third-party provider had flagged the domain catch-all.
      perAddressObservation: true,
    },
  };
}

export function verifyCacheStats(): { size: number } {
  return { size: cache().size };
}

/** Clear the per-email verification cache. Returns how many entries were removed. */
export function clearVerifyCache(): number {
  const n = cache().size;
  cache().clear();
  return n;
}

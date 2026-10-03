/**
 * Microsoft 365 mailbox existence via the GetCredentialType endpoint.
 *
 * Why this exists: M365 tenants refuse SMTP RCPT verification, so the Rust
 * engine's headless method returns `Inconclusive` for essentially every M365
 * mailbox — real deliverable addresses end up as `unknown`/`invalid`. Microsoft
 * itself, however, will say whether an account exists via the unauthenticated
 * `login.microsoftonline.com/common/GetCredentialType` API (the same call the
 * web login makes to decide which sign-in flow to show). It is a plain HTTPS
 * POST, so it works from any IP — no SMTP reputation needed.
 *
 * `IfExistsResult`: 0 = account exists, 1 = does not exist *or* the tenant hides
 * it (user-enumeration protection), others = federated/managed. A raw `0` is not
 * trustworthy on its own: some tenants return 0 for everything. So before
 * trusting a `0`, we probe a random non-existent mailbox on the same domain. If
 * that also returns 0, the tenant does not discriminate and we stay `unknown`;
 * only a domain that answers 1 for the fake mailbox is trusted, and there a real
 * mailbox's `0` means it genuinely exists.
 */
import "server-only";
import https from "node:https";

const GCT_URL = "https://login.microsoftonline.com/common/GetCredentialType?mkt=en-US";
const GCT_TIMEOUT_MS = Number(process.env.M365_GCT_TIMEOUT_MS ?? 8000);
const DISCRIMINATE_TTL_MS = Number(process.env.M365_DISCRIMINATE_TTL_MS ?? 7 * 24 * 3600 * 1000);

/** True when a domain's MX points at Microsoft 365 (Exchange Online). */
export function isM365Domain(mxRecords: string[] | undefined): boolean {
  return (mxRecords ?? []).some((r) => /\.mail\.protection\.outlook\.com\.?$/i.test(r.trim()));
}

interface GctResult {
  ifExists: number | null; // IfExistsResult, or null when the call failed
  throttled: boolean;
  skipped?: boolean; // short-circuited by the breaker (no call made)
  tenantThrottled?: boolean; // ThrottleStatus=1 — applies to the target tenant on every IP
}

// A bulk People pass fires hundreds of GetCredentialType calls; unpaced, Microsoft
// throttles them (ThrottleStatus / 429) → `null` → the tenant reads "can't tell" and
// every colleague settles Not found. Pace them through a small shared slot pool and
// retry a throttled/failed call with backoff before giving up.
const GCT_CONCURRENCY = Math.max(1, Number(process.env.M365_GCT_CONCURRENCY ?? 3));
const GCT_RETRIES = Math.max(0, Number(process.env.M365_GCT_RETRIES ?? 3));
let gctActive = 0;
const gctWaiters: Array<() => void> = [];
async function withGctSlot<T>(fn: () => Promise<T>): Promise<T> {
  const st = gctStats();
  const t0 = Date.now();
  st.waiting++;
  if (gctActive >= GCT_CONCURRENCY) await new Promise<void>((r) => gctWaiters.push(r));
  st.waiting--;
  st.waitMs += Date.now() - t0;
  gctActive++;
  const t1 = Date.now();
  try {
    return await fn();
  } finally {
    st.calls++;
    st.callMs += Date.now() - t1;
    gctActive--;
    gctWaiters.shift()?.();
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __gctStats: { calls: number; callMs: number; waitMs: number; waiting: number; throttled: number; shortCircuited: number } | undefined;
}
function gctStats() {
  if (!globalThis.__gctStats) globalThis.__gctStats = { calls: 0, callMs: 0, waitMs: 0, waiting: 0, throttled: 0, shortCircuited: 0 };
  return globalThis.__gctStats;
}
/** GetCredentialType pacing diagnostics. */
export function m365GctStats() {
  const st = gctStats();
  const now = Date.now();
  const open = [...breakers().entries()].filter(([, b]) => b.openUntil > now);
  return { ...st, active: gctActive, max: GCT_CONCURRENCY, sourceIps: GCT_SOURCE_IPS.length, throttledTenants: open.length, throttledSample: open.slice(0, 10).map(([t]) => t) };
}

// Per-TENANT circuit breaker. Microsoft's ThrottleStatus=1 is applied per target
// tenant, not per source IP (verified 2026-10-03: finclear.com.au / kpmg.com.au /
// unimelb.edu.au answer Throttle=1 on all 5 host IPs — even IPs never used for GCT,
// and even for a real mailbox — while qantas.com.au / westpac.com.au on the SAME IPs
// answer normally). Retrying such a tenant only adds delay (it was ~15s per call
// through the 3-slot pool, for every M365 candidate, and stalled whole passes), so
// once a tenant answers throttled it is short-circuited for a cool-down (answer
// "throttled" instantly → the caller treats it as inconclusive, as before). Other
// tenants keep working. After the cool-down one probe is let through; still
// throttled → that tenant's cool-down doubles (capped).
const GCT_COOLDOWN_MS = Math.max(10_000, Number(process.env.M365_GCT_COOLDOWN_MS ?? 10 * 60_000));
const GCT_COOLDOWN_MAX_MS = Math.max(GCT_COOLDOWN_MS, Number(process.env.M365_GCT_COOLDOWN_MAX_MS ?? 2 * 3600_000));
interface TenantBreaker { openUntil: number; cooldown: number; probing: boolean }
declare global {
  // eslint-disable-next-line no-var
  var __gctBreakers: Map<string, TenantBreaker> | undefined;
}
function breakers(): Map<string, TenantBreaker> {
  if (!globalThis.__gctBreakers) globalThis.__gctBreakers = new Map();
  return globalThis.__gctBreakers;
}
function tenantOf(email: string): string {
  return (email.split("@")[1] ?? "").toLowerCase();
}
/** True while this tenant is short-circuited; lets one probe through after its cool-down. */
function breakerBlocks(tenant: string): boolean {
  const b = breakers().get(tenant);
  if (!b) return false;
  if (Date.now() < b.openUntil) return true;
  if (b.probing) return true; // a half-open probe is already in flight
  b.probing = true;
  return false;
}
function breakerRecord(tenant: string, r: GctResult) {
  const map = breakers();
  const b = map.get(tenant);
  if (r.throttled) {
    const cooldown = b ? (b.probing ? Math.min(b.cooldown * 2, GCT_COOLDOWN_MAX_MS) : b.cooldown) : GCT_COOLDOWN_MS;
    map.set(tenant, { openUntil: Date.now() + cooldown, cooldown, probing: false });
  } else if (r.ifExists !== null) {
    map.delete(tenant); // tenant answers again → closed
  } else if (b) {
    b.probing = false; // network error: no verdict, let the next call probe
  }
}

async function getCredentialType(email: string): Promise<GctResult> {
  const tenant = tenantOf(email);
  let last: GctResult = { ifExists: null, throttled: false };
  for (let attempt = 0; attempt <= GCT_RETRIES; attempt++) {
    if (breakerBlocks(tenant)) {
      gctStats().shortCircuited++;
      return { ifExists: null, throttled: true };
    }
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500)));
    last = await withGctSlot(() => getCredentialTypeOnce(email));
    if (!last.skipped) breakerRecord(tenant, last);
    if (last.ifExists !== null && !last.throttled) return last;
    if (last.throttled) {
      gctStats().throttled++;
      return last; // tenant-throttled → retrying now cannot help (its breaker is open)
    }
  }
  return last;
}

// Microsoft throttles GetCredentialType PER SOURCE IP (ThrottleStatus=1 + a
// meaningless IfExistsResult=0). A bulk pass from the single primary IP trips it
// and every M365 candidate reads "can't tell" → Not found. When the host has
// several public IPs, rotate the call across them and fail over to the next IP
// on a throttled answer. Comma list, e.g. "51.195.149.22,51.38.86.17,51.68.203.255";
// empty → default route (previous behaviour).
const GCT_SOURCE_IPS = (process.env.M365_GCT_SOURCE_IPS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
let gctIpCursor = 0;

async function getCredentialTypeOnce(email: string): Promise<GctResult> {
  // Queued behind the slot pool while another call tripped this tenant's breaker → skip.
  if (Date.now() < (breakers().get(tenantOf(email))?.openUntil ?? 0)) return { ifExists: null, throttled: true, skipped: true };
  if (GCT_SOURCE_IPS.length === 0) return getCredentialTypeVia(email, undefined);
  let last: GctResult = { ifExists: null, throttled: false };
  for (let i = 0; i < GCT_SOURCE_IPS.length; i++) {
    const ip = GCT_SOURCE_IPS[gctIpCursor++ % GCT_SOURCE_IPS.length];
    last = await getCredentialTypeVia(email, ip);
    if (last.ifExists !== null && !last.throttled) return last;
    if (last.tenantThrottled) return last; // per-tenant: another IP gets the same answer
  }
  return last;
}

function getCredentialTypeVia(email: string, localAddress: string | undefined): Promise<GctResult> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ Username: email });
    const req = https.request(
      GCT_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "Content-Length": Buffer.byteLength(body) },
        localAddress,
        family: 4, // the bound source IPs are IPv4
        timeout: GCT_TIMEOUT_MS,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
            return resolve({ ifExists: null, throttled: res.statusCode === 429 });
          }
          try {
            const json = JSON.parse(raw) as { IfExistsResult?: number; ThrottleStatus?: number };
            const tenantThrottled = (json.ThrottleStatus ?? 0) !== 0;
            resolve({
              ifExists: typeof json.IfExistsResult === "number" ? json.IfExistsResult : null,
              throttled: tenantThrottled,
              tenantThrottled,
            });
          } catch {
            resolve({ ifExists: null, throttled: false });
          }
        });
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve({ ifExists: null, throttled: false }));
    req.end(body);
  });
}

/** Per-domain: does GetCredentialType tell existing and non-existing apart? */
interface DiscriminateFact {
  discriminates: boolean;
  at: number;
}
declare global {
  // eslint-disable-next-line no-var
  var __m365DiscriminateCache: Map<string, DiscriminateFact> | undefined;
}
function discriminateCache(): Map<string, DiscriminateFact> {
  if (!globalThis.__m365DiscriminateCache) globalThis.__m365DiscriminateCache = new Map();
  return globalThis.__m365DiscriminateCache;
}

/** A random, almost-certainly-nonexistent local part used as the control probe. */
function fakeLocalPart(): string {
  return `zz-no-such-user-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * Does this M365 tenant distinguish real from fake mailboxes? Cached per domain
 * (a fake mailbox's verdict is stable for the tenant's enumeration policy).
 * Returns null when we couldn't tell (throttled / call failed) — caller stays
 * conservative.
 */
export async function domainDiscriminates(domain: string): Promise<boolean | null> {
  const cached = discriminateCache().get(domain);
  if (cached && Date.now() - cached.at <= DISCRIMINATE_TTL_MS) return cached.discriminates;

  const control = await getCredentialType(`${fakeLocalPart()}@${domain}`);
  if (control.throttled || control.ifExists === null) return null; // inconclusive; don't cache
  // A tenant that returns "exists" (0) for a random fake mailbox cannot be
  // trusted — treat it as non-discriminating.
  const discriminates = control.ifExists !== 0;
  discriminateCache().set(domain, { discriminates, at: Date.now() });
  return discriminates;
}

/**
 * Confirm a single M365 mailbox. Returns "exists" ONLY when the tenant is known
 * to discriminate and Microsoft says this exact account exists; otherwise
 * "inconclusive" (never a false positive — an ambiguous tenant stays unknown).
 */
export async function m365MailboxExists(email: string): Promise<"exists" | "absent" | "inconclusive"> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return "inconclusive";

  const discriminates = await domainDiscriminates(domain);
  if (discriminates !== true) return "inconclusive";

  const real = await getCredentialType(email);
  if (real.throttled || real.ifExists === null) return "inconclusive";
  if (real.ifExists === 0 || real.ifExists === 5 || real.ifExists === 6) return "exists";
  // A clean (unthrottled) "not found" on a discriminating tenant. Distinct from
  // "inconclusive" so callers only spend a fallback check on the throttled ones.
  return real.ifExists === 1 ? "absent" : "inconclusive";
}

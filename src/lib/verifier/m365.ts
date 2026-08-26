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
}

async function getCredentialType(email: string): Promise<GctResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GCT_TIMEOUT_MS);
  try {
    const res = await fetch(GCT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ Username: email }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return { ifExists: null, throttled: res.status === 429 };
    const json = (await res.json()) as { IfExistsResult?: number; ThrottleStatus?: number };
    return {
      ifExists: typeof json.IfExistsResult === "number" ? json.IfExistsResult : null,
      throttled: (json.ThrottleStatus ?? 0) !== 0,
    };
  } catch {
    return { ifExists: null, throttled: false };
  } finally {
    clearTimeout(timer);
  }
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
async function domainDiscriminates(domain: string): Promise<boolean | null> {
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
export async function m365MailboxExists(email: string): Promise<"exists" | "inconclusive"> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return "inconclusive";

  const discriminates = await domainDiscriminates(domain);
  if (discriminates !== true) return "inconclusive";

  const real = await getCredentialType(email);
  if (real.throttled || real.ifExists === null) return "inconclusive";
  return real.ifExists === 0 ? "exists" : "inconclusive";
}

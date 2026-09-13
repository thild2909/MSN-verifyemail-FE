/**
 * Pure orchestration helpers for the People email finder's layer pipeline.
 *
 * These encode the branching/escalation DECISIONS (no network, no server-only
 * deps) so they can be unit-tested deterministically — the layer implementations
 * (SMTP/SERP/LLM) are injected. Keeping this logic here is what lets the
 * regression suite lock the layer ordering + the L5 web-search escalation that
 * previously regressed.
 */

/** A finder outcome state after which the pattern layers (L2/L4/public/L3) keep trying. */
export function layerContinues(state: string): boolean {
  return state === "not_found" || state === "no_mx";
}

// Registrable-domain helpers — so a scraped email is only trusted when its domain
// actually belongs to the target company. A name-matched address on an UNRELATED
// domain (e.g. mrashid@uwf.edu for someone at cukrudev.com) is a different person.
const TWO_PART_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "com.sg", "edu.sg", "gov.sg",
  "com.my", "com.br", "co.za", "com.mx", "co.jp", "com.hk", "com.tw", "co.id", "com.vn", "co.in", "co.kr", "com.cn",
]);
export function registrableDomain(host: string): string {
  const h = (host ?? "").toLowerCase().replace(/^[^@]*@/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").replace(/[^a-z0-9.-]/g, "");
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  return (TWO_PART_TLDS.has(lastTwo) ? parts.slice(-3) : parts.slice(-2)).join(".");
}
/** Do an email/host domain and a company website domain share a registrable domain? */
export function sameCompanyDomain(emailOrDomain: string, websiteDomain: string): boolean {
  const a = registrableDomain(emailOrDomain);
  const b = registrableDomain(websiteDomain);
  return !!a && !!b && a === b;
}
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "yahoo.co.uk", "hotmail.com", "hotmail.co.uk",
  "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me",
  "protonmail.com", "gmx.com", "gmx.net", "mail.com", "zoho.com", "yandex.com", "qq.com", "163.com", "126.com",
]);
export function isFreeMailDomain(emailOrDomain: string): boolean {
  return FREE_MAIL_DOMAINS.has((emailOrDomain ?? "").toLowerCase().replace(/^[^@]*@/, ""));
}
/**
 * Is a scraped email trustworthy as THIS person's, given the company website
 * domain? Yes when it's on the company's own (registrable) domain, or a free-mail
 * personal address whose local-part carries BOTH the first and last name. An
 * unrelated corporate/edu domain (namesake) is rejected.
 */
export function scrapedEmailTrusted(email: string, websiteDomain: string | null | undefined, first: string, last: string): boolean {
  const dom = (email.split("@")[1] ?? "");
  if (!dom) return false;
  if (websiteDomain && sameCompanyDomain(dom, websiteDomain)) return true;
  const local = (email.split("@")[0] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const f = (first ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const l = (last ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const strongName = f.length >= 2 && l.length >= 2 && local.includes(f) && local.includes(l);
  return isFreeMailDomain(dom) && strongName;
}

/**
 * Split rows for domain-aware two-round scheduling: the FIRST row of each domain
 * becomes a `probe` (round 1 — it makes the finder LEARN that domain's winning
 * pattern / dead-MX fact), and every other row goes to `rest` (round 2 — reuses
 * the learned fact, ~1 SMTP). Rows with no domain go straight to `rest` (no shared
 * learning possible). Order-preserving; pure (no I/O) so it's unit-testable.
 */
export function partitionByDomain<T>(
  items: T[],
  domainOf: (t: T) => string,
  probeScore?: (t: T) => number,
): { probes: T[]; rest: T[] } {
  if (!probeScore) {
    // Fast path: first row of each domain is the probe.
    const seen = new Set<string>();
    const probes: T[] = [];
    const rest: T[] = [];
    for (const it of items) {
      const d = domainOf(it);
      if (!d) { rest.push(it); continue; }
      if (seen.has(d)) rest.push(it);
      else { seen.add(d); probes.push(it); }
    }
    return { probes, rest };
  }
  // Pick the HIGHEST-scoring row of each domain as its probe — one most likely to
  // resolve and thus LEARN the pattern (a clean first+last, not an already-found
  // row), so more colleagues hit the fast path. Order-preserving for `rest`.
  const groups = new Map<string, T[]>();
  const probes: T[] = [];
  const rest: T[] = [];
  for (const it of items) {
    const d = domainOf(it);
    if (!d) { rest.push(it); continue; }
    const g = groups.get(d);
    if (g) g.push(it);
    else groups.set(d, [it]);
  }
  for (const rows of groups.values()) {
    let best = 0;
    for (let i = 1; i < rows.length; i++) if (probeScore(rows[i]) > probeScore(rows[best])) best = i;
    probes.push(rows[best]);
    for (let i = 0; i < rows.length; i++) if (i !== best) rest.push(rows[i]);
  }
  return { probes, rest };
}

/**
 * Is a local-part distinctive enough to trust on an UNCERTAIN (web-guessed) domain?
 * On a domain we didn't have as input, a collision-prone 2-char initials or a short
 * truncation (`cp`, `raj`) verifying `valid` is more likely a namesake than our
 * person — so for domain-less rows we accept only name-bearing locals (containing a
 * separator, or ≥7 chars like `johnsmith`/`given.family`). Precision guard; the
 * strong full-name patterns (the common case) still pass.
 */
export function isDistinctiveLocal(local: string): boolean {
  return /[._-]/.test(local) || local.replace(/[^a-z0-9]/gi, "").length >= 7;
}

/**
 * Verify ranked email candidates FAST without changing which one wins.
 *
 * Candidates are given in PRIORITY order (index 0 = most likely, e.g. a learned
 * domain pattern). We check candidate[0] alone first — so a learned-pattern hit
 * still costs exactly ONE call — then verify the rest in bounded-parallel batches
 * and return the HIGHEST-priority candidate the backend confirms valid. This is
 * accuracy-identical to a strict sequential "stop at first valid" scan (the same
 * winner), it just parallelizes the tail so a full not-found sweep isn't N serial
 * round-trips. Short-circuits on an MX failure (a domain with no MX can't have any
 * valid mailbox). Returns every probed result too, so the caller can still compute
 * a best catch-all / not-found from them.
 */
export async function verifyRanked<C extends { email: string }, R>(
  candidates: C[],
  verify: (email: string) => Promise<R>,
  isValid: (r: R) => boolean,
  isMxFail: (r: R) => boolean,
  opts: { concurrency?: number } = {},
): Promise<{ winner: { cand: C; result: R } | null; mxFail: boolean; results: Array<{ cand: C; result: R }> }> {
  const results: Array<{ cand: C; result: R }> = [];
  if (candidates.length === 0) return { winner: null, mxFail: false, results };
  const conc = Math.max(1, opts.concurrency ?? 5);

  // 1) First candidate alone — keeps the learned/priority-0 hit at one call.
  const first = await verify(candidates[0].email);
  results.push({ cand: candidates[0], result: first });
  if (isMxFail(first)) return { winner: null, mxFail: true, results };
  if (isValid(first)) return { winner: { cand: candidates[0], result: first }, mxFail: false, results };

  // 2) Remaining candidates, priority order, bounded-parallel. Stop at the first
  //    batch containing a valid (a later, lower-priority candidate can't win).
  const rest = candidates.slice(1);
  for (let i = 0; i < rest.length; i += conc) {
    const batch = rest.slice(i, i + conc);
    const probed = await Promise.all(batch.map(async (cand) => ({ cand, result: await verify(cand.email) })));
    for (const p of probed) results.push(p);
    if (probed.some((p) => isMxFail(p.result))) return { winner: null, mxFail: true, results };
    const hit = probed.find((p) => isValid(p.result)); // batch is in priority order
    if (hit) return { winner: hit, mxFail: false, results };
  }
  return { winner: null, mxFail: false, results };
}

const SENIOR_ROLE = /\b(chief|ceo|cto|cfo|coo|cmo|cro|cio|ciso|cpo|chro|founder|co-?founder|cofounder|president|vice\s*president|\bvp\b|svp|evp|head\s+of|managing\s+director|managing\s+partner|general\s+manager|proprietor)\b/i;
const GENERIC_OWNER = /\b(product|project|process|scrum|data|business|service|account|program|delivery|risk|change|feature|epic|platform)\s+owner\b/i;

/**
 * Should Layer 3 (reverse role→profile lookup) even be attempted for this title?
 * That SERP lookup only resolves a person reliably for a DISTINCTIVE/senior title;
 * for a generic PM/IC title ("Product Owner", "Project Owner", "Analyst") it
 * returns namesakes and usually fails — so skip it (Layer 5's slug/web path
 * corrects the name instead). Skipping only saves a wasted SERP; precision is
 * unchanged because L3 only ever surfaced SMTP-verified emails anyway.
 */
export function titleResolvableForReverseLookup(title: string | null | undefined): boolean {
  if (!title) return false;
  if (SENIOR_ROLE.test(title)) return true;
  if (/\bowner\b/i.test(title) && !GENERIC_OWNER.test(title)) return true; // standalone "Owner" (small biz)
  if (/\bdirector\b/i.test(title) && !/\b(associate|assistant|deputy)\b/i.test(title)) return true;
  return false;
}

const cleanDom = (v: string | null | undefined): string =>
  (v ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").replace(/[^a-z0-9.-]/g, "");

export interface EscalTarget {
  domain?: string | null;
  companyEmail?: string | null;
}

/**
 * Choose which knowledge-only MISSES are worth the ~8k-token web-search pass, and
 * cap the count. Any miss might be an M&A/moved-domain case — the email domain
 * can't reveal it (Camms's support email is still on the old domain) — so we do
 * NOT demote same-domain rows. We only PROMOTE rows with no website domain at all
 * (which can't be resolved without discovery); everything else keeps FIFO order.
 */
export function webEscalationTargets<T extends EscalTarget>(misses: T[], cap: number): T[] {
  if (cap <= 0) return [];
  const score = (t: T): number => (cleanDom(t.domain) ? 0 : 1);
  // Stable sort by descending priority; keep original order within a tier.
  return misses
    .map((t, i) => ({ t, i, s: score(t) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, cap)
    .map((x) => x.t);
}

/**
 * Demand-driven Layer-5 escalation. Runs the knowledge-only resolver for every
 * target; escalates ONLY the unresolved ones (capped/prioritized) to the
 * web-search resolver. A web `valid` wins; else the knowledge result; else the
 * web result (for its corrected-name/altName), else not-found. Injecting
 * `knowledge`/`web` makes the whole decision testable without network.
 */
export async function escalateL5<R extends { valid: boolean }, T extends EscalTarget>(
  targets: T[],
  deps: {
    idOf: (t: T) => string;
    knowledge: (ts: T[]) => Promise<Map<string, R>>;
    web: (ts: T[]) => Promise<Map<string, R>>;
    escalate: boolean;
    cap: number;
    notFound: () => R;
  },
): Promise<Map<string, R>> {
  const out = new Map<string, R>();
  if (targets.length === 0) return out;
  const a = await deps.knowledge(targets);
  const misses = deps.escalate ? targets.filter((t) => !a.get(deps.idOf(t))?.valid) : [];
  const webTargets = webEscalationTargets(misses, deps.cap);
  const b = webTargets.length ? await deps.web(webTargets) : new Map<string, R>();
  for (const t of targets) {
    const id = deps.idOf(t);
    const av = a.get(id);
    const bv = b.get(id);
    out.set(id, bv?.valid ? bv : av?.valid ? av : (bv ?? av ?? deps.notFound()));
  }
  return out;
}

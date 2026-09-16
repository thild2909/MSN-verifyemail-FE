/**
 * Email Finder - pattern library + candidate ranking.
 *
 * Given a person's first name, last name and company domain, we can't know
 * their address directly, so we:
 *
 *   1. Generate candidates from a curated set of corporate email FORMATS, in a
 *      fixed priority order (`prior`).
 *   2. Verify each candidate against the backend (SMTP / catch-all). The
 *      backend's deliverability score is what the UI shows as the Score.
 *   3. Rank by that backend score; when scores tie (every address on a
 *      catch-all domain returns the same score), fall back to the pattern
 *      priority via `comparePriorDesc`.
 */
/* ------------------------------ name parts ------------------------------ */

export interface NameParts {
  first: string; // cleaned, e.g. "john"
  last: string; // cleaned, e.g. "smith"
  fi: string; // first initial, e.g. "j"
  li: string; // last initial, e.g. "s"
}

/** Lowercase, strip accents, and drop anything illegal in a local-part. */
export function cleanToken(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics (é -> e)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Best-effort normalise a company/URL/domain string to a bare domain. */
export function cleanDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/[^a-z0-9.-]/g, "");
}

export function nameParts(first: string, last: string): NameParts {
  const f = cleanToken(first);
  const l = cleanToken(last);
  return { first: f, last: l, fi: f.slice(0, 1), li: l.slice(0, 1) };
}

/* ------------------------------- patterns ------------------------------- */

export interface EmailPattern {
  id: string;
  /** Human-readable template shown in the UI, e.g. "{first}.{last}". */
  label: string;
  /** Real-world frequency weight. Used only as a *relative* rank signal. */
  prior: number;
  /** Build the local-part (before the @) from the name parts. */
  local: (n: NameParts) => string;
}

/**
 * The finder's candidate formats, in fixed priority order. Every candidate is
 * SMTP-verified, so on a normal (non-catch-all) domain only the REAL format is
 * deliverable — breadth here directly raises recall. Besides the common
 * first-name formats we include first-initial + last ("{f}{last}" → smain) and
 * last-name-led formats ("{last}" → zhao, "{last}{first}" → tanjun) that are
 * standard at many Asian/SG companies. The prior only breaks ties when
 * verification can't decide (catch-all domains), where first.last still wins.
 */
export const EMAIL_PATTERNS: EmailPattern[] = [
  { id: "first.last", label: "{first}.{last}", prior: 0.4, local: (n) => `${n.first}.${n.last}` },
  { id: "first", label: "{first}", prior: 0.2, local: (n) => n.first },
  { id: "flast", label: "{f}{last}", prior: 0.18, local: (n) => `${n.fi}${n.last}` }, // smain
  { id: "firstl", label: "{first}{l}", prior: 0.14, local: (n) => `${n.first}${n.li}` },
  { id: "firstlast", label: "{first}{last}", prior: 0.12, local: (n) => `${n.first}${n.last}` },
  { id: "first_last", label: "{first}_{last}", prior: 0.08, local: (n) => `${n.first}_${n.last}` },
  { id: "f.last", label: "{f}.{last}", prior: 0.07, local: (n) => `${n.fi}.${n.last}` }, // s.main
  { id: "first.l", label: "{first}.{l}", prior: 0.06, local: (n) => `${n.first}.${n.li}` },
  { id: "last", label: "{last}", prior: 0.05, local: (n) => n.last }, // zhao
  { id: "lastfirst", label: "{last}{first}", prior: 0.045, local: (n) => `${n.last}${n.first}` }, // tanjun
  { id: "last.first", label: "{last}.{first}", prior: 0.035, local: (n) => `${n.last}.${n.first}` },
  { id: "lastf", label: "{last}{f}", prior: 0.03, local: (n) => `${n.last}${n.fi}` }, // mains
  { id: "first-last", label: "{first}-{last}", prior: 0.02, local: (n) => `${n.first}-${n.last}` },
];

const MAX_PRIOR = Math.max(...EMAIL_PATTERNS.map((p) => p.prior));

/** Prior scaled to 0..1 (the single most common format scores 1.0). */
export function normalizePrior(prior: number): number {
  return prior / MAX_PRIOR;
}

/** Look up a pattern's normalized prior from its "{first}.{last}" label. */
export function priorNormForLabel(label: string): number {
  const p = EMAIL_PATTERNS.find((x) => x.label === label);
  return p ? normalizePrior(p.prior) : 0.5;
}

export interface Candidate {
  patternId: string;
  patternLabel: string;
  prior: number;
  priorNorm: number; // 0..1
  local: string;
  email: string;
}

/** Tidy stray separators a pattern may leave when a part is empty. */
function tidyLocal(local: string): string {
  return local
    .replace(/[._-]{2,}/g, (m) => m[0]) // collapse "john..smith"
    .replace(/^[._-]+|[._-]+$/g, ""); // trim leading/trailing separators
}

/**
 * Build de-duplicated candidate addresses in descending prior order. When two
 * formats collapse to the same address (common for short names), the higher-
 * prior pattern is kept.
 */
export function buildCandidates(
  first: string,
  last: string,
  domain: string,
  limit = EMAIL_PATTERNS.length,
): Candidate[] {
  const n = nameParts(first, last);
  const d = cleanDomain(domain);
  const seen = new Map<string, Candidate>();

  for (const p of EMAIL_PATTERNS) {
    const local = tidyLocal(p.local(n));
    if (!local || !d) continue;
    const email = `${local}@${d}`;
    if (seen.has(email)) continue; // patterns iterate high->low prior, keep first
    seen.set(email, {
      patternId: p.id,
      patternLabel: p.label,
      prior: p.prior,
      priorNorm: normalizePrior(p.prior),
      local,
      email,
    });
  }

  return Array.from(seen.values()).slice(0, limit);
}

/* ------------------------------- ordering ------------------------------- */

/**
 * Tie-breaker for ranking candidates that share the same backend score - the
 * common case on a catch-all domain, where every address returns the same
 * `catch_all` score. Higher pattern prior sorts first, so the display falls
 * back to the curated pattern order when verification can't distinguish them.
 */
export function comparePriorDesc(labelA: string, labelB: string): number {
  return priorNormForLabel(labelB) - priorNormForLabel(labelA);
}

/* --------------------- pattern inference (reverse) ---------------------- */

/**
 * Reverse-map a KNOWN local-part to the EmailPattern that produced it, given the
 * person's name. Used to LEARN a domain's convention from a colleague's confirmed
 * email (e.g. `john@acme.com` for John Smith → pattern id "first"), so the rest of
 * the company's people can be resolved on the same pattern even when their own
 * address can't be SMTP-verified (catch-all / opaque domain). Returns the pattern
 * id, or null when no curated pattern reproduces the local exactly.
 */
export function derivePatternId(local: string, first: string, last: string): string | null {
  const n = nameParts(first, last);
  // Separator-PRESERVING fold: `john.s` and `johns` are DIFFERENT patterns (first.l vs
  // firstl), so we must not strip the dot/underscore/hyphen when matching — otherwise
  // colleagues inherit the wrong format. Keep [a-z0-9._-]; only fold case + accents.
  const foldLocal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const L = foldLocal(local);
  if (!L) return null;
  for (const p of EMAIL_PATTERNS) {
    const built = tidyLocal(p.local(n));
    if (built && foldLocal(built) === L) return p.id;
  }
  return null;
}

/** Look up a pattern by id. */
export function patternById(id: string): EmailPattern | undefined {
  return EMAIL_PATTERNS.find((p) => p.id === id);
}

/**
 * Build the email for a specific pattern id from a name + domain (no verification).
 * Used to surface a domain's LEARNED convention as a best guess on a domain SMTP
 * can't verify. Returns null when the pattern yields an empty local.
 */
export function buildEmailForPattern(patternId: string, first: string, last: string, domain: string): { local: string; email: string; label: string } | null {
  const p = patternById(patternId);
  const d = cleanDomain(domain);
  if (!p || !d) return null;
  const local = tidyLocal(p.local(nameParts(first, last)));
  if (!local || local.length < 1) return null;
  return { local, email: `${local}@${d}`, label: p.label };
}

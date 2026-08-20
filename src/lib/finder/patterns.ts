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
 * The finder's candidate formats, in fixed priority order. This is a curated,
 * first-name-based set (every format starts with the full first name); the
 * first-initial formats like `{f}{last}` are intentionally excluded. The prior
 * encodes the desired ranking and is only used as a *relative* tie-breaker when
 * verification can't decide (e.g. catch-all domains).
 */
export const EMAIL_PATTERNS: EmailPattern[] = [
  { id: "first.last", label: "{first}.{last}", prior: 0.4, local: (n) => `${n.first}.${n.last}` },
  { id: "first", label: "{first}", prior: 0.2, local: (n) => n.first },
  { id: "firstl", label: "{first}{l}", prior: 0.14, local: (n) => `${n.first}${n.li}` },
  { id: "firstlast", label: "{first}{last}", prior: 0.12, local: (n) => `${n.first}${n.last}` },
  { id: "first_last", label: "{first}_{last}", prior: 0.08, local: (n) => `${n.first}_${n.last}` },
  { id: "first.l", label: "{first}.{l}", prior: 0.06, local: (n) => `${n.first}.${n.li}` },
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

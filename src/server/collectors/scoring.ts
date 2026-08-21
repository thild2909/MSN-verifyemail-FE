/**
 * Entity-resolution scoring. Turns a company name + location + a candidate
 * search result into a 0..1 confidence, using the weighting from the spec:
 *
 *   score = name_similarity * 0.5 + location_match * 0.3 + domain_match * 0.2
 */
import "server-only";

const LEGAL_SUFFIX = /\b(inc|llc|ltd|limited|corp|co|gmbh|group|holdings|holding|pte|pty|plc|sa|srl|bv|ag|labs|the)\b/gi;

export function normalizeName(s: string): string {
  return (s ?? "").toLowerCase().replace(LEGAL_SUFFIX, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

export function nameTokens(s: string): string[] {
  return normalizeName(s).split(/\s+/).filter((t) => t.length > 1);
}

/** Jaccard overlap of two token sets (0..1). */
export function tokenSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const inter = a.filter((t) => setB.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}

/** The registrable label of a URL/host, e.g. "https://www.abc.co.uk/x" → "abc". */
export function domainLabel(urlOrHost: string): string {
  let host = urlOrHost;
  try { host = new URL(/^https?:\/\//i.test(urlOrHost) ? urlOrHost : `https://${urlOrHost}`).hostname; } catch { /* keep raw */ }
  host = host.replace(/^www\./i, "");
  const parts = host.split(".");
  if (parts.length <= 2) return parts[0] ?? "";
  // Drop known 2-part public suffixes (co.uk, com.sg, com.au …) to find the label.
  const twoPart = /^(co|com|net|org|gov|edu|ac)\.[a-z]{2}$/i;
  const tail = parts.slice(-2).join(".");
  return (twoPart.test(tail) ? parts[parts.length - 3] : parts[parts.length - 2]) ?? "";
}

export interface Candidate { url: string; title?: string; snippet?: string }

/** Full candidate score (0..1) for a resolved website. */
export function scoreCandidate(name: string, location: string, c: Candidate): number {
  const nTokens = nameTokens(name);
  const label = domainLabel(c.url);
  const titleTokens = nameTokens(c.title ?? "");
  const nameSim = Math.max(tokenSimilarity(nTokens, titleTokens), tokenSimilarity(nTokens, nameTokens(label)));

  const labelJoined = label.replace(/[^a-z0-9]/g, "");
  const nameJoined = nTokens.join("");
  const domainMatch = labelJoined && nameJoined && (labelJoined.includes(nameJoined) || nameJoined.includes(labelJoined) || nTokens.some((t) => labelJoined.includes(t)))
    ? 1 : 0;

  const hay = `${c.title ?? ""} ${c.snippet ?? ""}`.toLowerCase();
  const locTokens = location.toLowerCase().split(/[,\s]+/).filter((t) => t.length > 2);
  const locHits = locTokens.filter((t) => hay.includes(t)).length;
  const locationMatch = locTokens.length ? locHits / locTokens.length : 0;

  return nameSim * 0.5 + locationMatch * 0.3 + domainMatch * 0.2;
}

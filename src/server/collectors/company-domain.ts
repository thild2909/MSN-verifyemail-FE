import { cleanDomain } from "@/lib/finder/patterns";

/**
 * Best-effort domain guess from a raw company name — used by the resolver as a
 * fallback before the real website is found via web search. If the input
 * already looks like a domain it is cleaned and returned; otherwise the name is
 * slugified into a `<slug>.com` guess.
 */
export function companyToDomain(value: string): string {
  const s = (value ?? "").trim().toLowerCase();
  if (!s) return "";
  const d = cleanDomain(s);
  if (d.includes(".") && !d.includes(" ")) return d;
  const slug = s
    .replace(/\b(inc|llc|ltd|corp|co|gmbh|group|company|holdings|labs)\b/gi, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
  return slug ? `${slug}.com` : "";
}

/**
 * Only http(s) links from crawled / imported / LLM data may become an <a href>.
 * Anything else (javascript:, data:, vbscript:, file:, …) yields undefined, so
 * the anchor renders inert. React 19 already blocks javascript: URLs; this is
 * defense in depth for the other schemes.
 */
export function safeHref(raw: string | null | undefined): string | undefined {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

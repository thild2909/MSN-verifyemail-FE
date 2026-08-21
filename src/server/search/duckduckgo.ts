/**
 * Keyless search provider: scrapes DuckDuckGo's HTML endpoint through the
 * rotating proxy pool. No API key, no captcha on the `html.duckduckgo.com`
 * variant, real real-time results. Lower quality than Google but far better
 * than guessing a domain from the company name.
 *
 * DDG wraps result links in a redirect (`/l/?uddg=<encoded-target>`); we decode
 * the `uddg` parameter back to the real URL.
 */
import "server-only";
import { fetchViaProxy } from "../proxy-fetch";
import { fingerprintFor, proxyLabel, toLike, type ProxyRotator } from "../collectors/context";
import type { SearchProvider, SearchResponse, SearchResult } from "./index";

function decodeDdgUrl(href: string): string {
  let h = href.trim();
  if (h.startsWith("//")) h = "https:" + h;
  try {
    const u = new URL(h);
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (/duckduckgo\.com\/l\//i.test(h)) return ""; // redirect we couldn't decode
    return h;
  } catch {
    return h.startsWith("http") ? h : "";
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

function parseResults(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  // Each organic result is an <a class="result__a" href="…">title</a> followed
  // (further down the block) by an <a class="result__snippet">snippet</a>.
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html))) snippets.push(stripTags(sm[1]));
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = linkRe.exec(html))) {
    const url = decodeDdgUrl(m[1]);
    if (!url) { i++; continue; }
    out.push({ title: stripTags(m[2]), url, snippet: snippets[i] ?? "" });
    i++;
    if (out.length >= 20) break;
  }
  return out;
}

export function duckDuckGoProvider(rotator: ProxyRotator): SearchProvider {
  return {
    name: "duckduckgo",
    async search(query: string): Promise<SearchResponse> {
      const key = `ddg:${query}`;
      let proxy = rotator.next(key);
      let ms = 0;
      for (let bump = 0; ; bump++) {
        const res = await fetchViaProxy(
          `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`,
          toLike(proxy),
          { timeoutMs: 9000, maxBytes: 400_000, fingerprint: fingerprintFor(key, bump) },
        );
        ms += res.ms;
        if (res.ok && res.body) {
          const results = parseResults(res.body);
          // An empty body with 200 usually means a soft block / anomaly page.
          const blocked = results.length === 0 && /anomaly|blocked|unusual traffic/i.test(res.body);
          return { results, ms, ok: results.length > 0, proxy: proxyLabel(proxy), blocked };
        }
        const transient = res.status === 429 || res.status === null || (res.status !== null && res.status >= 500);
        if (transient && bump < 2 && rotator.active) {
          rotator.rotations++; proxy = rotator.next(key); ms += 300; continue;
        }
        return { results: [], ms, ok: false, proxy: proxyLabel(proxy), blocked: res.status === 403 };
      }
    },
  };
}

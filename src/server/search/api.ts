/**
 * Keyed SERP provider — used automatically when SEARCH_API_KEY is set in the
 * environment. Supports Serper.dev, SerpAPI and Brave Search; the shape differs
 * but each returns Google-quality organic results with no captcha. Requests go
 * through the proxy pool too, so the exit IP still rotates.
 */
import "server-only";
import { fetchViaProxy } from "../proxy-fetch";
import { fingerprintFor, proxyLabel, toLike, type ProxyRotator } from "../collectors/context";
import type { SearchProvider, SearchResponse, SearchResult } from "./index";

export type ApiProviderName = "serper" | "serpapi" | "brave";

function parse(provider: ApiProviderName, body: string): SearchResult[] {
  let json: unknown;
  try { json = JSON.parse(body); } catch { return []; }
  const j = json as Record<string, unknown>;
  const out: SearchResult[] = [];
  const push = (title: unknown, url: unknown, snippet: unknown) => {
    if (typeof url === "string" && url) out.push({ title: String(title ?? ""), url, snippet: String(snippet ?? "") });
  };
  if (provider === "serper" || provider === "serpapi") {
    const organic = (j.organic ?? (j as { organic_results?: unknown }).organic_results) as Array<Record<string, unknown>> | undefined;
    for (const r of organic ?? []) push(r.title, r.link, r.snippet);
  } else {
    const web = (j.web as { results?: Array<Record<string, unknown>> } | undefined)?.results;
    for (const r of web ?? []) push(r.title, r.url, r.description);
  }
  return out.slice(0, 20);
}

export function apiProvider(name: ApiProviderName, apiKey: string, rotator: ProxyRotator): SearchProvider {
  return {
    name,
    async search(query: string): Promise<SearchResponse> {
      const key = `serp:${query}`;
      const proxy = rotator.next(key);
      const fp = fingerprintFor(key);
      let url = "";
      const opts: Parameters<typeof fetchViaProxy>[2] = { timeoutMs: 12_000, maxBytes: 300_000, fingerprint: fp };
      if (name === "serper") {
        url = "https://google.serper.dev/search";
        opts.method = "POST";
        opts.headers = { "X-API-KEY": apiKey, "Content-Type": "application/json" };
        opts.body = JSON.stringify({ q: query, num: 10 });
      } else if (name === "serpapi") {
        url = `https://serpapi.com/search.json?engine=google&num=10&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}`;
      } else {
        url = `https://api.search.brave.com/res/v1/web/search?count=10&q=${encodeURIComponent(query)}`;
        opts.headers = { "X-Subscription-Token": apiKey, Accept: "application/json" };
      }
      const res = await fetchViaProxy(url, toLike(proxy), opts);
      const results = res.ok ? parse(name, res.body) : [];
      return { results, ms: res.ms, ok: results.length > 0, proxy: proxyLabel(proxy) };
    },
  };
}

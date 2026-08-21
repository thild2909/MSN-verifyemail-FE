/**
 * Search provider selector. Uses a keyed SERP API when SEARCH_API_KEY (+ optional
 * SEARCH_PROVIDER) is present in the environment; otherwise falls back to the
 * keyless DuckDuckGo scraper. Same interface either way, so the resolver — and
 * everything downstream — never knows which is in use.
 */
import "server-only";
import type { ProxyRotator } from "../collectors/context";
import { duckDuckGoProvider } from "./duckduckgo";
import { apiProvider, type ApiProviderName } from "./api";

export interface SearchResult { title: string; url: string; snippet: string }
export interface SearchResponse {
  results: SearchResult[];
  ms: number;
  ok: boolean;
  proxy: string | null;
  blocked?: boolean;
}
export interface SearchProvider {
  name: string;
  search(query: string): Promise<SearchResponse>;
}

const API_PROVIDERS: ApiProviderName[] = ["serper", "serpapi", "brave"];

export function getSearchProvider(rotator: ProxyRotator): SearchProvider {
  const key = process.env.SEARCH_API_KEY?.trim();
  if (key) {
    const name = (process.env.SEARCH_PROVIDER?.trim().toLowerCase() as ApiProviderName) || "serper";
    if (API_PROVIDERS.includes(name)) return apiProvider(name, key, rotator);
  }
  return duckDuckGoProvider(rotator);
}

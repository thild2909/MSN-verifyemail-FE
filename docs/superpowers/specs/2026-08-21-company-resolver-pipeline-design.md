# Company Collection Pipeline Redesign — Resolver → Sources → Merge → Cache

**Date:** 2026-08-21
**Scope:** `/find-leads?tab=companies` end-to-end (FE + BE)
**Goal:** Collect company data accurately and in real time from multiple sources,
the way Apollo / Clay do — instead of guessing a domain from the company name.

## Problem

Today the collector turns `"ABC Pte Ltd"` into `abcpteltd.com` by slugifying the
name (`companyToDomain`). That guess is wrong for most real companies, so every
downstream fetch targets the wrong site. The website fetch is real; LinkedIn /
Maps / social / other are simulated.

## Decisions (approved)

1. **Resolver is pluggable:** DuckDuckGo (keyless, scraped through the proxy pool)
   by default; a SERP API (Serper / SerpAPI / Brave) when `SEARCH_API_KEY` +
   `SEARCH_PROVIDER` are in `.env`. Auto-upgrades when a key appears.
2. **Real where keyless-feasible; simulated stays honest.**
   - REAL: resolver (DDG/SERP), multi-page website crawl, OpenCorporates free API.
   - SIMULATED (clearly badged in code + UI): LinkedIn firmographics, Google Maps,
     business directory.
3. Cache in-memory + JSON on disk (no Redis in this env), 30-day TTL.

## Architecture

```
CSV (Company + Location)
  → Resolver            find REAL website + LinkedIn (search queries → best match)
  → Task Queue          existing worker pool (concurrency from ProxyConfig)
  → Source Collectors   pluggable, one module per source
       ├ website          REAL  multi-page (/ /contact /about /team), email/phone/social/OG
       ├ opencorporates   REAL  legal name, jurisdiction, reg number, incorporation year
       ├ linkedin         SIM   industry / employees / founded / description
       ├ google_maps      SIM   address / phone / rating
       └ directory        SIM   jurisdiction-aware (SG ACRA / AU ABN)
  → Merge               cross-source agreement raises confidence; keeps attribution
  → Output table
  (Cache wraps resolver + whole company result, 30-day TTL, JSON-persisted)
```

## Modules

| File | Role | Real? |
|------|------|-------|
| `server/search/index.ts` | provider selector (`getSearchProvider`) | — |
| `server/search/duckduckgo.ts` | scrape `html.duckduckgo.com` via proxy | REAL |
| `server/search/api.ts` | Serper / SerpAPI / Brave via key | REAL |
| `server/collectors/context.ts` | `Cfg`, `ProxyRotator`, `sf`/`attempt` helpers | — |
| `server/collectors/resolver.ts` | queries → best website + LinkedIn + confidence | REAL |
| `server/collectors/website.ts` | depth-≤2 multi-page crawl + extraction | REAL |
| `server/collectors/opencorporates.ts` | free OpenCorporates API | REAL |
| `server/collectors/simulated.ts` | linkedin / maps / directory (badged) | SIM |
| `server/collectors/merge.ts` | scoring + agreement merge | — |
| `server/collectors/cache.ts` | JSON-persisted 30-day cache | — |
| `server/company-collector.ts` | orchestrator wiring the above | — |
| `server/proxy-fetch.ts` | + rotating User-Agent / Accept-Language | REAL |

## Data-model additions (`lib/leads/collect-types.ts`)

- `CollectionSource` gains `search`, `opencorporates`, `directory`.
- `SourcedField` gains `agreement?: number` (how many sources agreed).
- `CollectionAttempt` gains `simulated?`, `pages?`, `provider?`, `cacheHit?`, `detail?`.
- `CollectedCompany` gains `resolution: ResolutionInfo | null` and legal fields
  `legalName`, `jurisdiction`, `registrationNumber`, `incorporated`.
- `ResolutionInfo = { website, linkedin, confidence, provider, query, cacheHit }`.
- `CollectSummary` gains `resolved`, `cacheHits`, `withLegalEntity`.

## Scoring (entity resolution)

`score = name_similarity*0.5 + location_match*0.3 + domain_match*0.2` (0–100),
used to accept/reject a resolved candidate and to seed resolution confidence.
On merge, when ≥2 sources supply the same normalized value, its confidence is
boosted and `agreement` incremented.

## FE

- Drawer: **Resolution** section (query, provider, website+LinkedIn found, confidence,
  cache-hit badge); richer per-source log (website shows pages crawled; simulated
  sources show a "Simulated" badge); legal-entity fields; agreement shown on fields.
- Stat bar: add **Resolved**, **Cache hits**, **Legal entity**.
- New source badges: search / opencorporates / directory.
- Import + proxy settings unchanged.

## Honesty

Only resolver, website and opencorporates are REAL. LinkedIn / Maps / directory are
deterministic mock, badged `Simulated` in the UI and commented in code, behind the
same `Source` interface so a real implementation can be dropped in later.

## Non-goals (this pass)

Redis, Kafka/RabbitMQ, Playwright browser pool, residential-proxy provisioning,
paid enrichment APIs. The interfaces are shaped so these can replace the
keyless/simulated pieces without touching the FE or orchestrator.

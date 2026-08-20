# Enrichment — Clay/Apollo-style rebuild (supersedes company-enrichment design)

**Date:** 2026-08-20
**Status:** Implemented & verified. Replaces the earlier one-shot company-enrichment page.

## Why

The first `/enrich` did "company name → auto-discover people + generic emails" in one
shot — that's *prospecting/discovery* (which Find Leads now owns), not *enrichment*.
Per Clay/Apollo, enrichment = bring YOUR list of records → append fields per row via
**enrichment columns (waterfalls)**, each cell showing status + winning source + confidence.

## Decisions (confirmed with user)

- **Clay-style enrichment table**: rows = imported records, columns = enrichments (waterfalls); per-cell status/source/confidence; chainable columns.
- **People + Companies** (People complete first; both supported since columns are generic).
- **Reuse + refactor** the existing backend (persisted table + background runner + credit gate).

## Model (`src/lib/types.ts`)

`EnrichmentTable` (recordType, importedColumns, identityColumns, `columns: EnrichColumn[]`, status, summary) · `EnrichRow` (fields + `cells: Record<colId, EnrichCell>`) · `EnrichCell` (status, value, detail, **source**, confidence, **waterfall: WaterfallStep[]**, credits) · `EnrichColumn` (kind, name, costPerRow).

Column kinds (`src/lib/enrich/columns.ts`): find_work_email, verify_email, find_phone, find_linkedin (people); enrich_company, company_tech, ai_research (both); generic_emails (companies).

## Engine (`src/server/enrichment-engine.ts`)

`runCell(kind, ctx)` → an `EnrichCell` with its waterfall. Key runner:
- **find_work_email**: builds candidate patterns (priority order), verifies each via `cachedVerify` (same backend + caches as the finder). Records each pattern as a waterfall step (hit/miss). Stops on the first `valid`; otherwise surfaces the strongest non-`invalid` guess (catch-all/risky flagged by confidence); only rejected/dead → not_found. Chains its result into `ctx.resolvedEmail` so **verify_email** downstream reuses it.
- Others are deterministic mock providers (firmographics, technographics, role mailboxes, LinkedIn, phone, AI angle) keyed on the domain via `seededRandom`.

## Store / runner / API

- `enrich-store.ts`: table + rows + cells, `.data/enrich.json` (with a shape guard for the old model). `createEnrichTable`, `addColumn`, `removeColumn`, `applyCell`, `rerunEnrichTable`, `collectEmails`. Credit gate via shared ledger (`estimateTableCredits` / `estimateColumnCredits`).
- `enrich-job.ts`: fire-and-forget; rows processed with a bounded pool, columns run IN ORDER per row so chaining works.
- API `/api/v1/enrich`: `POST`/`GET`; `[id]` GET/PATCH/DELETE; `[id]/rows` GET (search/filter/paginate); `[id]/columns` POST add / DELETE remove; `[id]/run` POST re-run; `[id]/export` CSV/XLSX; `[id]/push-to-verification` (loop-closer).

## UI

- `/enrich`: list of enrichment tables + import flow (record type → upload → map columns → pick starting enrichment columns → cost estimate → create).
- `/enrich/[id]`: **the Clay spreadsheet** — sticky Record column on the left, one column per enrichment (icon + name + column menu to remove), **"+ Add enrichment"** column (menu of available kinds with cost), per-cell rendering (value + source chip / status glyph / spinner), click a cell → **waterfall detail dialog** (ordered providers with hit/miss, winning source, copy). Search + filter + pagination + live polling while enriching. Compact stats + Re-run + Export + Push to verification.

## Verification

- typecheck + build clean.
- Runtime: companies table → all cells found (firmographics/tech/generic/LinkedIn with sources); people email waterfall on real domains → `billg@microsoft.com` (hit at pattern `{first}{l}`, conf 95, 3-step waterfall), `timc@apple.com`; add/remove column; export CSV; push-to-verification created a processing list. Fake domains correctly return not_found (honest, Clay-like).

## Note

The email waterfall calls the live `check-if-email-exists` backend; with many rows this is genuinely slow (real SMTP). Set `EMAIL_VERIFIER_TIMEOUT_MS` low in dev if the backend is offline so the mock fallback answers fast.

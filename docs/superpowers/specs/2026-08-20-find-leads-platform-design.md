# Find Leads — Lead Intelligence Platform (Design + Phase Status)

**Date:** 2026-08-20
**Author:** david@mindsupernova.com
**Status:** Phase 1 (People) implemented & verified. Phases 2–3 planned.

## Decisions (confirmed with user)

1. **Relationship:** New section *alongside* Enrichment (Enrichment = bulk CSV; Find Leads = interactive prospecting).
2. **Sequencing:** People-first, full — build the People tab production-ready plus all shared infrastructure; Companies & Jobs reuse it in later phases.
3. **Design tokens:** Use the app's existing token system (keeps dark mode + consistency). The tokens already match the brief: `--primary` is indigo `243 75% 59%`, `--valid` green (Verified/Excellent), `--risky` orange (Fair/Warning).
4. **Data:** Deterministic mock via `seededRandom`. Headline stats (8.4K / 2.7M / 124K) are static index labels; tables operate on a realistic in-memory sample that filters/sorts/paginates live.

## Architecture

- **Route group `(leads)`** with a full-bleed, viewport-locked layout (Sidebar + Topbar, no `max-w`), so the platform owns the whole canvas with an independently scrolling filter sidebar + results table. Route: `/find-leads`.
- **Data layer** (`src/lib/leads/`): `types.ts` (Person/Company/Job + per-tab filter/sort/column types), `data.ts` (deterministic generators + shared query engine `queryPeople/queryCompanies/queryJobs` with filter → sort → paginate), `nl-search.ts` (natural-language → filter chips).
- **Components** (`src/components/leads/`): `find-leads` (orchestrator: URL state, selection, sort, pagination, keyboard shortcuts), `leads-tabs`, `stat-cards`, `search-bar` (NL "AI understood your search as" panel), `toolbar-menus` (Research with AI / Create workflow / Default view / Relevance), `search-settings` (columns + rows-per-page), `filter-primitives` (FilterSection / TokenList / CheckboxList / ChipToggleGroup / RangeMin), `people-filter-sidebar`, `people-table`, `lead-detail-drawer`, `bulk-action-bar`, `leads-ui` (avatars, chips, qualification pill, hiring-signal, score bar).

## Phase 1 — People (DONE)

Covers spec sections 1–6, 14–19, 22–23 for People:
- 3-tab nav (People/Companies/Jobs) with active highlight.
- Header toolbar: Default view, Hide/Show Filters, Research with AI, Create workflow, Save as new search, Relevance, Search settings.
- Stat cards (Total / Net New / Saved).
- Filter sidebar (280px, independently scrolling, collapsible sections): Lists, Persona, Email Status, Job Titles (include chips), People/Company Lookalikes, Company (exclude chips), Seniority, Department, Location/Country, Company Size, Industry, Technology, Availability (email/LinkedIn). Active-filter badge + Clear all.
- Results table: sticky header, dense rows, checkbox multi-select, avatar + clickable name → drawer, job title, company logo + name, email status + **Access email**, **Access Mobile**, location, LinkedIn, hover quick actions + More menu. Sortable columns, column visibility, pagination.
- Bulk action bar (Save / Add to list / Verify emails / Find emails / Workflow / Export).
- Lead detail drawer (Contact / Professional / AI Insights ICP score + reasons / Company / Actions).
- Natural-language search → parsed filter chips → Apply.
- URL-based filter state (tab + `q` + compact `pf`), filter persistence on reload, keyboard shortcuts (`/` focus search, `f` toggle filters, `Esc` clear selection), loading/empty states.

## Phase 2 — Companies (PLANNED)

Spec sections 7–10. Reuse table/filter/bulk infra. Add: company filter sidebar (industry, employees range, funding, technologies, keywords, lookalikes), company table (Employees / **AI Qualification** pill / Company Score / Industry / Location / Website / LinkedIn), and the **AI Account Qualification** side panel (score /50, ICP/size/industry/tech/hiring breakdown bars, "Why this company?" reasons). Data model + `queryCompanies` + qualification scoring already implemented in `data.ts`.

## Phase 3 — Jobs + AI Research execution (PLANNED)

Spec sections 11–13, 15. Jobs filter sidebar (title, work mode, employment type, seniority, posted-date, salary, tech, company size, hiring signal) + jobs table (Job / Company / Location / Employment / Posted / Size / Technology / **Hiring Signal**). Wire Research-with-AI actions to real output panels. Data model + `queryJobs` already implemented.

## Verification

- `npm run typecheck` — clean.
- `npm run build` — success; `/find-leads` prerenders (19.1 kB).
- Runtime smoke (dev): `/find-leads` 200 with fully populated SSR table; `?tab=companies|jobs` render their headers/placeholders; `?q=cto` returns a filtered People table. No compile/runtime errors.

## Out of scope (YAGNI)

Real data providers, server-side persistence for saved searches/lists, column resizing/drag-reorder (kept to visibility toggles + sorting), workflow execution engine.

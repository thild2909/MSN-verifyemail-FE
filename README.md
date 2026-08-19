# Verifly — Email Verification & Finder (Frontend)

A production-quality **Next.js 15 + TypeScript + Tailwind CSS** frontend for an email
verification, bulk validation, and email-finder SaaS. Built as a self-contained FE with a
**typed mock API layer** so a real backend can be dropped in with no component changes.

> Demo interface. Not affiliated with, and not copying the branding of, any existing product.

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 3.4** (stable line) with a design-token theme + dark mode
- **TanStack Query** for all data fetching (against the mock API)
- **Recharts** for analytics, **PapaParse** for real client-side CSV parsing
- **Zod** for the domain schema, **lucide-react** icons
- Hand-rolled, shadcn-style UI primitives (no CLI/network dependency)

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run typecheck  # tsc --noEmit
```

## What works (interactive)

- **Single email verification** — real multi-signal engine (syntax, domain, MX, disposable/role/free
  detection, deterministic scoring) with a Deep Scan (SMTP/catch-all) upgrade.
- **Bulk upload flow** — drag & drop CSV/TXT (parsed for real) or XLSX (simulated): auto-detect email
  column → dedupe → credit estimate vs. balance → live progress → results.
- **Lists** — searchable/sortable table, row actions, and a detailed report page with summary cards,
  safe-to-send rate, and a paginated + filterable results table with a verification detail drawer.
- **Email Finder** — by person or by company domain, with confidence scoring and per-result verify.
- **Billing/Credits** — balances, configurable credit costs, purchase dialog, transaction history.
- **API** — status, endpoints, key management (create/reveal-once/revoke), and webhook configuration.
- **Analytics** — volume, quality trend, and credit-consumption charts with date ranges.
- **Settings** — profile, team/roles, and security (2FA, sessions).
- **Auth** — polished login/register screens (demo redirect).
- Inbox Placement & Blacklist Monitor ship as architected "Coming soon" modules.

## Architecture

```
src/
  app/
    (auth)/            login, register  — split-screen auth shell
    (app)/             dashboard shell (sidebar + topbar) wrapping every product route
  components/
    ui/                design-system primitives (button, card, table, dialog, drawer, toast, …)
    verification/      upload flow, single-verify, lists/results tables, detail drawer
    finder/  analytics/  api/  layout/  common/  settings/
  lib/
    types.ts           domain model + Zod schemas
    credit-config.ts   credit pricing (single source of truth; backend-served in prod)
    nav.ts             sidebar navigation
    mock/
      verification-engine.ts   VerificationProvider interface + deterministic engine
      data.ts                  seed data + record generators
    api/client.ts      the ONLY data source the UI reads from — swap bodies for fetch("/api/v1/...")
```

### Live backend integration (`check-if-email-exists`)

Verification is wired to the Rust **`check-if-email-exists` / Supernova** backend (default
`http://localhost:8080`).

```
Browser ──► Next route handler (server) ──► POST /v1/check_email ──► Rust backend
  (client)      /api/v1/verify                (CheckEmailOutput)        (DNS + MX + SMTP)
                      │
                      └── maps CheckEmailOutput → VerificationResult
```

- **Why a server-side proxy?** It avoids browser CORS, keeps the optional shared secret
  (`x-supernova-secret`) off the client, and centralizes the response mapping.
- **Files:** `src/app/api/v1/verify/route.ts` (proxy), `src/app/api/health/route.ts` (status),
  `src/lib/verifier/backend.ts` (server-only caller), `src/lib/verifier/reacher.ts` (response → `VerificationResult` mapper).
- **What's live:** single verification, the Finder's per-row *Verify*, list *Deep Scan*, and the bulk
  upload flow (verifies parsed CSV emails through the proxy with a bounded worker pool, capped at
  `MAX_LIVE_VERIFY = 200` per session since real SMTP checks are slow).
- **Graceful fallback:** if the backend is unreachable, the proxy falls back to the local heuristic
  engine and flags `provider: "mock"` (the UI shows a *Simulated* badge). The app never hard-fails.

#### Configuration (`.env.local`)

```bash
EMAIL_VERIFIER_URL=http://localhost:8080     # the Rust backend
# EMAIL_VERIFIER_SECRET=my-secret            # only if RCH__HEADER_SECRET is set on the backend
# EMAIL_VERIFIER_TIMEOUT_MS=60000            # per-request timeout
```

#### Running the backend

From the `check-if-email-exists` repo (sibling folder):

```bash
cargo run --bin backend            # serves http://127.0.0.1:8080
```

> Note: SMTP verification needs outbound port 25. Many ISPs/clouds block it — in that case
> results legitimately come back `unknown`/`risky`, and a SOCKS5 proxy can be configured in
> the backend's `backend_config.toml`.

### The application backend (server-owned `/verification`)

The email-verification microservice only checks single emails — it doesn't own lists, results,
credits, or bulk jobs. So the app ships its own backend as Next.js server route handlers plus a
persistent store, delegating the actual checking to the Rust engine:

```
src/server/store.ts            file-backed store (.data/store.json): lists, records, credits
src/server/verification-job.ts background job: verifies each email via the Rust engine
src/app/api/v1/lists/…         GET (list) · POST (create + start job)
src/app/api/v1/lists/[id]      GET one list · PATCH rename · DELETE
src/app/api/v1/lists/[id]/records         GET server-side paginated + filtered records
src/app/api/v1/lists/[id]/deep-scan       POST re-verify one record (charges credits)
src/app/api/v1/lists/[id]/reprocess       POST re-queue the whole list (charges credits)
src/app/api/v1/lists/[id]/export          GET server-generated CSV / XLSX (optional ?filter=)
src/app/api/v1/credits, …/transactions    GET server-enforced credit balance + history
```

Flow: **upload → parse (CSV/XLSX in the browser) → `POST /api/v1/lists` → server dedupes, charges
credits, starts a background job → job verifies each email through the Rust engine and stores
results → the UI polls `GET /api/v1/lists/:id` for live progress.** Verification continues on the
server even if you close the tab.

- Credits are deducted and enforced by the server (a `402 INSUFFICIENT_CREDITS` blocks creation).
- Interactive lists are capped at `APP_MAX_LIST_EMAILS` (default 500); a real deployment would swap
  the in-process job for a queue + Postgres (the Rust backend already ships that under `RCH_ENABLE_BULK`).
- The store persists to `.data/store.json`. Delete that file to reset to seed data.

### Still seed data

Finder, analytics, API keys, integrations, and team read seed data through
`src/lib/api/client.ts`. Replace those bodies with real `fetch` calls the same way — the React
Query hooks, components, and types stay untouched.

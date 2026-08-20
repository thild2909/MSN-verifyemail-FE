/**
 * Server-side store for Clay/Apollo-style enrichment tables.
 *
 * Owns enrichment tables + their rows (each row carries its imported fields and
 * a cell per enrichment column). Persists to its own `.data/enrich.json`.
 * Actual enrichment is done by the background runner (`enrich-job.ts`) via the
 * engine (`enrichment-engine.ts`); credits go through the shared ledger.
 */
import "server-only";
import fs from "fs";
import path from "path";
import { charge, getCredits, CreditsError } from "./store";
import { estimateTableCredits, estimateColumnCredits } from "@/lib/enrich/cost";
import { columnSpec } from "@/lib/enrich/columns";
import type {
  EnrichCell, EnrichColumn, EnrichColumnKind, EnrichRecordType, EnrichRow,
  EnrichTableSummary, EnrichmentTable,
} from "@/lib/types";

// Re-export so `/api/v1/enrich/*` routes reference it as `store.CreditsError`.
export { CreditsError };

export const MAX_ENRICH_ROWS = Number(process.env.APP_MAX_ENRICH_ROWS ?? 200);

interface EnrichStoreData {
  tables: EnrichmentTable[];
  rows: Record<string, EnrichRow[]>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "enrich.json");

declare global {
  // eslint-disable-next-line no-var
  var __enrichStore: EnrichStoreData | undefined;
}

function load(): EnrichStoreData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      // Guard against an older/incompatible on-disk shape (pre-Clay model).
      if (parsed && Array.isArray(parsed.tables) && parsed.rows && typeof parsed.rows === "object") {
        return parsed as EnrichStoreData;
      }
    }
  } catch { /* corrupt file → start empty */ }
  const empty: EnrichStoreData = { tables: [], rows: {} };
  persistNow(empty);
  return empty;
}

function getStore(): EnrichStoreData {
  if (!globalThis.__enrichStore) globalThis.__enrichStore = load();
  return globalThis.__enrichStore;
}

let saveTimer: NodeJS.Timeout | null = null;
function persistNow(data: EnrichStoreData) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data));
  } catch { /* best-effort */ }
}
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; persistNow(getStore()); }, 1500);
}

/* --------------------------------- helpers ------------------------------- */

function pendingCell(): EnrichCell {
  return { status: "pending", value: null, detail: null, source: null, confidence: null, waterfall: [], credits: 0 };
}

function makeColumn(kind: EnrichColumnKind): EnrichColumn {
  const spec = columnSpec(kind);
  return { id: `col_${kind}_${Math.random().toString(36).slice(2, 7)}`, kind, name: spec.name, costPerRow: spec.costPerRow };
}

/** The best-known email for a row (found email/verify cell, else imported). */
function rowEmail(row: EnrichRow, columns: EnrichColumn[]): string | null {
  for (const c of columns) {
    if ((c.kind === "verify_email" || c.kind === "find_work_email") && row.cells[c.id]?.status === "found") {
      return row.cells[c.id].value;
    }
  }
  return (row.fields.email ?? "").trim() || null;
}

/* -------------------------------- reads ---------------------------------- */

export function listEnrichTables(): EnrichmentTable[] {
  return getStore().tables.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export function getEnrichTable(id: string): EnrichmentTable | undefined {
  return getStore().tables.find((t) => t.id === id);
}

export function rawRows(id: string): EnrichRow[] {
  return getStore().rows[id] ?? [];
}

export interface RowsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  filter?: string; // "all" | "has_email" | "no_email" | "enriched" | "pending"
}

export interface RowsPage {
  rows: EnrichRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function getRows(id: string, query: RowsQuery = {}): RowsPage {
  const table = getEnrichTable(id);
  const all = getStore().rows[id] ?? [];
  const { page = 1, pageSize = 25, search = "", filter = "all" } = query;
  const columns = table?.columns ?? [];

  let filtered = all;
  const q = search.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(
      (r) =>
        Object.values(r.fields).some((v) => v.toLowerCase().includes(q)) ||
        Object.values(r.cells).some((c) => (c.value ?? "").toLowerCase().includes(q)),
    );
  }
  if (filter === "has_email") filtered = filtered.filter((r) => !!rowEmail(r, columns));
  else if (filter === "no_email") filtered = filtered.filter((r) => !rowEmail(r, columns));
  else if (filter === "enriched") filtered = filtered.filter((r) => Object.values(r.cells).some((c) => c.status === "found"));
  else if (filter === "pending") filtered = filtered.filter((r) => Object.values(r.cells).some((c) => c.status === "pending" || c.status === "running"));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  return { rows: filtered.slice(start, start + pageSize), total, page, pageSize };
}

/* ------------------------------- mutations ------------------------------- */

export interface CreateEnrichInput {
  name: string;
  fileName: string;
  recordType: EnrichRecordType;
  importedColumns: string[];
  identityColumns: string[];
  rows: Record<string, string>[];
  columns: EnrichColumnKind[]; // starting enrichment columns
}

export function createEnrichTable(input: CreateEnrichInput): { table: EnrichmentTable; truncated: number } {
  // Dedupe by identity (fallback: whole-row signature).
  const seen = new Set<string>();
  const unique: Record<string, string>[] = [];
  for (const fields of input.rows) {
    const key = (input.identityColumns.length ? input.identityColumns : input.importedColumns)
      .map((c) => (fields[c] ?? "").trim().toLowerCase()).join("|");
    if (!key.replace(/\|/g, "") || seen.has(key)) continue;
    seen.add(key);
    unique.push(fields);
  }

  const capped = unique.slice(0, MAX_ENRICH_ROWS);
  const truncated = unique.length - capped.length;

  const columns = input.columns.map(makeColumn);
  const cost = estimateTableCredits(capped.length, columns);
  const available = getCredits().totalRemaining;
  if (cost > available) throw new CreditsError(cost, available);

  const id = `enr_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const now = new Date().toISOString();
  const table: EnrichmentTable = {
    id,
    name: input.name,
    fileName: input.fileName,
    recordType: input.recordType,
    status: "enriching",
    importedColumns: input.importedColumns,
    identityColumns: input.identityColumns,
    columns,
    progress: 0,
    summary: { rows: capped.length, cellsRun: 0, cellsFound: 0, emailsFound: 0, creditsUsed: 0 },
    createdAt: now,
  };

  const store = getStore();
  store.rows[id] = capped.map((fields, i) => ({
    id: `${id}_${i}`,
    fields,
    cells: Object.fromEntries(columns.map((c) => [c.id, pendingCell()])),
  }));
  store.tables.push(table);

  if (cost > 0) charge(cost, "email_finder", `${input.name} — enrich ${capped.length} rows`);
  scheduleSave();
  return { table, truncated };
}

/** Append an enrichment column and seed pending cells (charges credits). */
export function addColumn(id: string, kind: EnrichColumnKind): EnrichmentTable {
  const store = getStore();
  const table = getEnrichTable(id);
  const rows = store.rows[id];
  if (!table || !rows) throw new Error("Table not found");

  const cost = estimateColumnCredits(rows.length, kind);
  const available = getCredits().totalRemaining;
  if (cost > available) throw new CreditsError(cost, available);

  const column = makeColumn(kind);
  table.columns.push(column);
  for (const r of rows) r.cells[column.id] = pendingCell();
  table.status = "enriching";
  table.completedAt = undefined;
  recompute(id);

  if (cost > 0) charge(cost, "email_finder", `${table.name} — add ${column.name}`);
  persistNow(store);
  return table;
}

export function removeColumn(id: string, colId: string): EnrichmentTable | undefined {
  const store = getStore();
  const table = getEnrichTable(id);
  const rows = store.rows[id];
  if (!table || !rows) return undefined;
  table.columns = table.columns.filter((c) => c.id !== colId);
  for (const r of rows) delete r.cells[colId];
  recompute(id);
  persistNow(store);
  return table;
}

export function applyCell(id: string, rowId: string, colId: string, cellData: EnrichCell) {
  const rows = getStore().rows[id];
  if (!rows) return;
  const row = rows.find((r) => r.id === rowId);
  if (!row) return;
  row.cells[colId] = cellData;
  recompute(id);
  scheduleSave();
}

export function setCellRunning(id: string, rowId: string, colId: string) {
  const rows = getStore().rows[id];
  const row = rows?.find((r) => r.id === rowId);
  if (row && row.cells[colId]) row.cells[colId].status = "running";
}

export function finalizeEnrichTable(id: string) {
  const table = getEnrichTable(id);
  if (!table) return;
  recompute(id);
  table.progress = 100;
  table.status = "completed";
  table.completedAt = new Date().toISOString();
  persistNow(getStore());
}

function recompute(id: string) {
  const table = getEnrichTable(id);
  const rows = getStore().rows[id];
  if (!table || !rows) return;

  const totalCells = rows.length * table.columns.length;
  let run = 0, found = 0, emails = 0, credits = 0;
  for (const r of rows) {
    for (const col of table.columns) {
      const c = r.cells[col.id];
      if (!c) continue;
      if (c.status === "found" || c.status === "not_found" || c.status === "error") run++;
      if (c.status === "found") {
        found++;
        credits += c.credits;
        if (col.kind === "find_work_email" || col.kind === "verify_email") emails++;
      }
    }
  }
  const summary: EnrichTableSummary = { rows: rows.length, cellsRun: run, cellsFound: found, emailsFound: emails, creditsUsed: credits };
  table.summary = summary;
  table.progress = totalCells ? Math.round((run / totalCells) * 100) : 100;
  if (run >= totalCells && table.status === "enriching") {
    table.status = "completed";
    table.completedAt = new Date().toISOString();
  }
}

export function deleteEnrichTable(id: string): boolean {
  const s = getStore();
  const before = s.tables.length;
  s.tables = s.tables.filter((t) => t.id !== id);
  delete s.rows[id];
  if (s.tables.length < before) { persistNow(s); return true; }
  return false;
}

export function renameEnrichTable(id: string, name: string): EnrichmentTable | undefined {
  const table = getEnrichTable(id);
  if (!table) return undefined;
  table.name = name;
  scheduleSave();
  return table;
}

/** Reset all cells to pending and re-run every column (charges credits). */
export function rerunEnrichTable(id: string): EnrichmentTable {
  const store = getStore();
  const table = getEnrichTable(id);
  const rows = store.rows[id];
  if (!table || !rows) throw new Error("Table not found");

  const cost = estimateTableCredits(rows.length, table.columns);
  const available = getCredits().totalRemaining;
  if (cost > available) throw new CreditsError(cost, available);

  for (const r of rows) for (const col of table.columns) r.cells[col.id] = pendingCell();
  table.status = "enriching";
  table.progress = 0;
  table.completedAt = undefined;
  recompute(id);

  if (cost > 0) charge(cost, "email_finder", `${table.name} — re-run`);
  persistNow(store);
  return table;
}

/** Emails discovered across a table, for push-to-verification. */
export function collectEmails(id: string): { email: string; fields: Record<string, string> }[] {
  const table = getEnrichTable(id);
  const rows = getStore().rows[id] ?? [];
  if (!table) return [];
  const out: { email: string; fields: Record<string, string> }[] = [];
  for (const r of rows) {
    const email = rowEmail(r, table.columns);
    if (email && email.includes("@")) out.push({ email, fields: r.fields });
  }
  return out;
}

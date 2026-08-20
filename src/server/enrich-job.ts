/**
 * Background enrichment runner. Started fire-and-forget when a table is created,
 * a column is added, or a re-run is requested. Rows are processed with a bounded
 * pool; within a row, columns run IN ORDER so later columns (e.g. Verify Email)
 * can chain off earlier ones (e.g. Work Email) via the shared row context.
 */
import "server-only";
import { runCell, buildRowContext } from "./enrichment-engine";
import * as store from "./enrich-store";
import type { EnrichCell } from "@/lib/types";

const CONCURRENCY = Number(process.env.APP_ENRICH_CONCURRENCY ?? 4);
const running = new Set<string>();

export function startEnrichJob(id: string) {
  if (running.has(id)) return;
  running.add(id);
  void run(id).finally(() => running.delete(id));
}

export function isEnrichRunning(id: string) {
  return running.has(id);
}

const errorCell = (): EnrichCell => ({ status: "error", value: null, detail: "Enrichment failed", source: null, confidence: null, waterfall: [], credits: 0 });

async function run(id: string) {
  const table = store.getEnrichTable(id);
  if (!table) return;
  const rows = store.rawRows(id);
  let next = 0;

  async function worker() {
    while (next < rows.length) {
      const row = rows[next++];
      const ctx = buildRowContext(table!.recordType, row.fields);

      for (const col of table!.columns) {
        const existing = row.cells[col.id];
        if (existing && existing.status !== "pending") {
          // Already computed — keep the chain context in sync and skip.
          if (col.kind === "find_work_email" && existing.status === "found" && existing.value) ctx.resolvedEmail = existing.value;
          continue;
        }
        store.setCellRunning(id, row.id, col.id);
        try {
          store.applyCell(id, row.id, col.id, await runCell(col.kind, ctx));
        } catch {
          store.applyCell(id, row.id, col.id, errorCell());
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length || 1) }, () => worker()));
  store.finalizeEnrichTable(id);
}

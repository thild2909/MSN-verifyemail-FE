import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { be } from "@/server/verify-client";
import type { EmailList, EmailRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Verification columns appended AFTER the original file columns. Only the
// headline verdict is exported — the per-check breakdown is intentionally omitted.
const RESULT_HEADER = ["verification_status", "verification_score"];

function resultCells(r: EmailRecord): (string | number)[] {
  const res = r.result;
  return [res?.status ?? "pending", res?.score ?? ""];
}

/** Reconstruct the record's ORIGINAL columns (as uploaded) from email + custom. */
function originalCells(r: EmailRecord, columns: string[], emailColumn: string): (string | number)[] {
  return columns.map((col) => (col === emailColumn ? r.email : r.custom?.[col] ?? ""));
}

// Legacy header for lists created before original columns were preserved.
const LEGACY_HEADER = ["email", "first_name", "last_name", "company", "job_title"];
function legacyCells(r: EmailRecord): (string | number)[] {
  return [r.email, r.firstName ?? "", r.lastName ?? "", r.company ?? "", r.jobTitle ?? ""];
}

/**
 * Deliverability filter applied to a record's status.
 *   all      → every record
 *   safe     → valid only              ("Safe to send")
 *   safe_ok  → valid + catch-all       ("Safe to send + Ok for All")
 *   <status> → exact status (results-table pills: valid/invalid/risky/…)
 */
function matchesFilter(status: string | undefined, filter: string): boolean {
  const s = status ?? "";
  switch (filter) {
    case "all":
      return true;
    case "safe":
      return s === "valid";
    case "safe_ok":
      return s === "valid" || s === "catch_all";
    default:
      return s === filter;
  }
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "csv").toLowerCase();
  const filter = url.searchParams.get("filter") ?? "all";

  // Always fetch ALL records, then apply the deliverability filter HERE. This is
  // independent of whether the BE knows the "safe"/"safe_ok" filter modes, so the
  // export is correct regardless of the deployed BE version.
  const res = await be<{ data: { list: EmailList; records: EmailRecord[] } }>(
    `/lists/${encodeURIComponent(id)}/records/all?filter=all`,
  );
  if (res.status === 404) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "List not found." } }, { status: 404 });
  }
  if (!res.ok) return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Export failed." } }, { status: 502 });

  const { list, records: allRecords } = res.json.data;
  const records = allRecords.filter((r) => matchesFilter(r.result?.status, filter));

  // Header + rows: original file columns first (complete, as imported), then the
  // verification result columns.
  const hasOriginal = Array.isArray(list.columns) && list.columns.length > 0;
  const header = hasOriginal ? [...list.columns, ...RESULT_HEADER] : [...LEGACY_HEADER, ...RESULT_HEADER];
  const rows = records.map((r) =>
    hasOriginal
      ? [...originalCells(r, list.columns, list.emailColumn), ...resultCells(r)]
      : [...legacyCells(r), ...resultCells(r)],
  );

  // Filename: keep the ORIGINAL uploaded filename, only swapping the extension
  // to match the chosen format.
  const ext = format === "xlsx" ? "xlsx" : "csv";
  const dot = list.fileName.lastIndexOf(".");
  const baseName = dot > 0 ? list.fileName.slice(0, dot) : list.fileName;
  const safeBase = baseName.replace(/["\r\n]+/g, "").trim() || "list";
  const filename = `${safeBase}.${ext}`;

  if (format === "xlsx") {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

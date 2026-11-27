/**
 * Minimal CSV builder + browser download for exporting lead selections.
 * Real client-side export — no backend round-trip.
 */
"use client";

/**
 * Neutralise spreadsheet formula injection (CWE-1236): crawled/uploaded values
 * such as `=HYPERLINK(...)` or `@SUM(...)` would execute when the CSV is opened
 * in Excel/Sheets. Prefix with an apostrophe unless the value is a plain number
 * or phone number (e.g. "+61 2 9999 0000", "-12.5"), which stay untouched.
 */
function defuseFormula(s: string): string {
  if (!/^[=+\-@\t\r]/.test(s)) return s;
  if (/^[+-]?[\d\s().-]+$/.test(s) && /\d/.test(s)) return s;
  return `'${s}`;
}

function cell(v: unknown): string {
  const s = defuseFormula(v == null ? "" : String(v));
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(cell).join(",")];
  for (const r of rows) lines.push(r.map(cell).join(","));
  return lines.join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

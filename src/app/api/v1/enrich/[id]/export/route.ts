import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import * as store from "@/server/enrich-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const table = store.getEnrichTable(id);
  if (!table) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Enrichment table not found." } }, { status: 404 });

  const format = (new URL(req.url).searchParams.get("format") ?? "csv").toLowerCase();
  const header = [...table.importedColumns, ...table.columns.map((c) => c.name)];
  const rows = store.rawRows(id).map((r) => [
    ...table.importedColumns.map((c) => r.fields[c] ?? ""),
    ...table.columns.map((c) => r.cells[c.id]?.value ?? ""),
  ]);

  const safeName = table.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();

  if (format === "xlsx") {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Enriched");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeName}.xlsx"`,
      },
    });
  }

  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${safeName}.csv"` },
  });
}

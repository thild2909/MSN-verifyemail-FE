import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import * as store from "@/server/store";
import type { EmailRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADER = [
  "email", "first_name", "last_name", "company", "job_title",
  "verification_status", "verification_score",
  "syntax", "mx_status", "smtp_status", "catch_all", "disposable", "role_based", "free_provider",
  "provider", "mx_server",
];

function toRow(r: EmailRecord): (string | number)[] {
  const res = r.result;
  return [
    r.email,
    r.firstName ?? "",
    r.lastName ?? "",
    r.company ?? "",
    r.jobTitle ?? "",
    res?.status ?? "pending",
    res?.score ?? "",
    res?.checks.syntax ?? "",
    res?.checks.mx ?? "",
    res?.checks.smtp ?? "",
    res ? String(res.checks.catchAll) : "",
    res ? String(res.checks.disposable) : "",
    res ? String(res.checks.roleBased) : "",
    res ? String(res.checks.freeProvider) : "",
    res?.provider ?? "",
    res?.mxRecords?.join(" ") ?? "",
  ];
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const list = store.getList(id);
  if (!list) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "List not found." } }, { status: 404 });
  }

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "csv").toLowerCase();
  const filter = url.searchParams.get("filter") ?? "all";

  let records = store.rawRecords(id);
  if (filter !== "all") records = records.filter((r) => r.result?.status === filter);

  const safeName = list.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  const suffix = filter === "all" ? "" : `-${filter}`;
  const rows = records.map(toRow);

  if (format === "xlsx") {
    const ws = XLSX.utils.aoa_to_sheet([HEADER, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeName}${suffix}.xlsx"`,
      },
    });
  }

  const csv = [HEADER, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}${suffix}.csv"`,
    },
  });
}

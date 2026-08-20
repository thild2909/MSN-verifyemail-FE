"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Search, MoreHorizontal, Trash2, Copy, Check, X, User, Building2, Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { getEnrichRows, addEnrichColumn, removeEnrichColumn, ApiError } from "@/lib/api/client";
import { columnsForType } from "@/lib/enrich/columns";
import { formatNumber, cn } from "@/lib/utils";
import { ColumnIcon, CellStatusGlyph, SourceChip } from "./enrich-ui";
import type { EnrichCell, EnrichColumn, EnrichColumnKind, EnrichRow, EnrichmentTable } from "@/lib/types";

const PAGE_SIZE = 25;

export function EnrichTable({ table }: { table: EnrichmentTable }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [cellView, setCellView] = React.useState<{ row: EnrichRow; col: EnrichColumn } | null>(null);

  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);
  React.useEffect(() => { setPage(1); }, [debounced, filter]);

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["enrich-rows", table.id, debounced, filter, page, table.columns.length],
    queryFn: () => getEnrichRows(table.id, { search: debounced, filter, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
    refetchInterval: table.status === "enriching" ? 1500 : false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["enrich-table", table.id] });
    qc.invalidateQueries({ queryKey: ["enrich-rows", table.id] });
    qc.invalidateQueries({ queryKey: ["credits"] });
  };
  const addCol = useMutation({
    mutationFn: (kind: EnrichColumnKind) => addEnrichColumn(table.id, kind),
    onSuccess: () => { invalidate(); toast({ variant: "info", title: "Column added", description: "Enriching new column…" }); },
    onError: (err) => toast({ variant: "error", title: err instanceof ApiError && err.code === "INSUFFICIENT_CREDITS" ? "Insufficient credits" : "Could not add column" }),
  });
  const removeCol = useMutation({
    mutationFn: (colId: string) => removeEnrichColumn(table.id, colId),
    onSuccess: () => { invalidate(); toast({ variant: "success", title: "Column removed" }); },
    onError: () => toast({ variant: "error", title: "Could not remove column" }),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const available = columnsForType(table.recordType);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search records or enriched values…" className="h-9 pl-9" />
        </div>
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 w-40">
          <option value="all">All rows</option>
          <option value="enriched">Enriched</option>
          <option value="has_email">Has email</option>
          <option value="no_email">No email</option>
          <option value="pending">Pending</option>
        </Select>
        <span className="text-sm text-muted-foreground"><span className="font-semibold text-foreground tabular-nums">{formatNumber(total)}</span> rows</span>
      </div>

      {/* Spreadsheet */}
      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : total === 0 ? (
          <EmptyState icon={Inbox} title="No rows match" description="Try clearing the search or filter." className="m-6" />
        ) : (
          <div className={cn("scrollbar-thin h-full overflow-auto transition-opacity", isPlaceholderData && "opacity-60")}>
            <table className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 z-20 bg-card">
                <tr className="border-b">
                  <th className="sticky left-0 z-30 min-w-[220px] border-r bg-card px-3 py-2.5 text-left font-medium text-muted-foreground">Record</th>
                  {table.columns.map((c) => (
                    <th key={c.id} className="min-w-[180px] border-r px-3 py-2.5 text-left font-medium">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-foreground"><ColumnIcon kind={c.kind} className="size-3.5 text-primary" /> {c.name}</span>
                        <DropdownMenu trigger={<button className="rounded p-0.5 text-muted-foreground hover:bg-muted" aria-label="Column menu"><MoreHorizontal className="size-3.5" /></button>}>
                          <DropdownItem destructive onClick={() => removeCol.mutate(c.id)}><Trash2 /> Remove column</DropdownItem>
                        </DropdownMenu>
                      </div>
                    </th>
                  ))}
                  <th className="min-w-[160px] px-3 py-2">
                    <AddEnrichmentButton available={available} existing={table.columns.map((c) => c.kind)} onAdd={(k) => addCol.mutate(k)} pending={addCol.isPending} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="group border-b hover:bg-muted/30">
                    <td className="sticky left-0 z-10 border-r bg-card px-3 py-2 group-hover:bg-muted/30">
                      <RecordCell row={row} table={table} />
                    </td>
                    {table.columns.map((c) => (
                      <td key={c.id} className="border-r px-3 py-2 align-top">
                        <CellView cell={row.cells[c.id]} onClick={() => row.cells[c.id] && setCellView({ row, col: c })} />
                      </td>
                    ))}
                    <td className="px-3 py-2" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
          <span>{formatNumber(total)} rows</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
            <span className="tabular-nums">Page {page} / {totalPages}</span>
            <Button size="sm" variant="outline" className="h-8" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
          </div>
        </div>
      )}

      <CellDetailDialog view={cellView} onClose={() => setCellView(null)} />
    </div>
  );
}

/* -------------------------------- pieces --------------------------------- */

function RecordCell({ row, table }: { row: EnrichRow; table: EnrichmentTable }) {
  const isPeople = table.recordType === "people";
  const primary = isPeople
    ? `${row.fields.first_name ?? ""} ${row.fields.last_name ?? ""}`.trim() || row.fields.company || "—"
    : row.fields.company || "—";
  const subtitle = isPeople ? row.fields.company : row.fields.email;
  const Icon = isPeople ? User : Building2;
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="size-3.5" /></span>
      <div className="min-w-0">
        <p className="truncate font-medium">{primary}</p>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

function CellView({ cell, onClick }: { cell: EnrichCell | undefined; onClick: () => void }) {
  if (!cell || cell.status === "pending" || cell.status === "running" || cell.status === "not_found" || cell.status === "error") {
    const status = (cell?.status ?? "pending") as "pending" | "running" | "not_found" | "error";
    return (
      <button onClick={onClick} className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CellStatusGlyph status={status} />
        {status === "not_found" ? "Not found" : status === "error" ? "Error" : status === "running" ? "Running…" : ""}
      </button>
    );
  }
  // found
  return (
    <button onClick={onClick} className="block w-full max-w-[220px] text-left">
      <span className="line-clamp-1 font-medium text-foreground">{cell.value}</span>
      {cell.source && <span className="mt-0.5 block"><SourceChip source={cell.source} confidence={cell.confidence} /></span>}
    </button>
  );
}

function AddEnrichmentButton({ available, existing, onAdd, pending }: { available: ReturnType<typeof columnsForType>; existing: EnrichColumnKind[]; onAdd: (k: EnrichColumnKind) => void; pending: boolean }) {
  return (
    <DropdownMenu
      align="start"
      className="w-72"
      trigger={
        <button className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-primary/40 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/5" disabled={pending}>
          <Plus className="size-3.5" /> Add enrichment
        </button>
      }
    >
      {available.map((c) => {
        const used = existing.includes(c.kind);
        return (
          <DropdownItem key={c.kind} onClick={() => onAdd(c.kind)}>
            <ColumnIcon kind={c.kind} />
            <span className="flex-1">
              <span className="flex items-center gap-1.5 font-medium">{c.name}{used && <Check className="size-3 text-[hsl(var(--valid))]" />}</span>
              <span className="block text-xs text-muted-foreground">{c.description}</span>
            </span>
            <span className="text-[10px] text-muted-foreground">{c.costPerRow} cr</span>
          </DropdownItem>
        );
      })}
    </DropdownMenu>
  );
}

function CellDetailDialog({ view, onClose }: { view: { row: EnrichRow; col: EnrichColumn } | null; onClose: () => void }) {
  const { toast } = useToast();
  if (!view) return null;
  const cell = view.row.cells[view.col.id];
  if (!cell) return null;
  const copy = (v: string) => { navigator.clipboard?.writeText(v); toast({ variant: "success", title: "Copied", description: v }); };

  return (
    <Dialog open={!!view} onOpenChange={(o) => !o && onClose()}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><ColumnIcon kind={view.col.kind} className="text-primary" /> {view.col.name}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        {cell.value ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{cell.value}</p>
              {cell.detail && <p className="text-xs text-muted-foreground">{cell.detail}</p>}
            </div>
            <div className="flex items-center gap-2">
              {cell.confidence != null && <span className="text-xs font-medium tabular-nums text-muted-foreground">{cell.confidence}%</span>}
              <Button size="icon" variant="ghost" aria-label="Copy" onClick={() => copy(cell.value!)}><Copy className="size-4" /></Button>
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">{cell.detail ?? "No value found."}</p>
        )}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Waterfall</p>
          {cell.waterfall.length === 0 ? (
            <p className="text-sm text-muted-foreground">No providers were run.</p>
          ) : (
            <ol className="space-y-1.5">
              {cell.waterfall.map((s, i) => (
                <li key={i} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                  <span className="flex items-center gap-2"><span className="text-xs tabular-nums text-muted-foreground">{i + 1}.</span> {s.source}</span>
                  {s.result === "hit" ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--valid))]"><Check className="size-3.5" /> Hit</span>
                  ) : s.result === "miss" ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"><X className="size-3.5" /> Miss</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Skipped</span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {cell.source && <p className="mt-2 text-xs text-muted-foreground">Winning source: <span className="font-medium text-foreground">{cell.source}</span></p>}
        </div>
      </div>
    </Dialog>
  );
}

"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, ChevronLeft, ChevronRight, Download, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "./status-badge";
import { DetailDrawer } from "./detail-drawer";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown-menu";
import { getListRecords, deepScanRecord } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import { cn, formatNumber } from "@/lib/utils";
import type { EmailRecord } from "@/lib/types";

const FILTERS = ["all", "valid", "invalid", "risky", "unknown", "disposable", "role", "catch_all"] as const;
const FILTER_LABELS: Record<(typeof FILTERS)[number], string> = {
  all: "All", valid: "Valid", invalid: "Invalid", risky: "Risky", unknown: "Unknown",
  disposable: "Disposable", role: "Role", catch_all: "Catch-all",
};

export function ResultsTable({ listId, live = false }: { listId: string; live?: boolean }) {
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [status, setStatus] = React.useState<(typeof FILTERS)[number]>("all");
  const [selected, setSelected] = React.useState<EmailRecord | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["records", listId, page, debounced, status],
    queryFn: () => getListRecords(listId, { page, pageSize: 12, search: debounced, status }),
    refetchInterval: live ? 3000 : false,
  });

  const deepScan = useMutation({
    mutationFn: (record: EmailRecord) => deepScanRecord(record),
    onSuccess: (result) => {
      setSelected((prev) => (prev ? { ...prev, result } : prev));
      qc.invalidateQueries({ queryKey: ["records", listId] });
      qc.invalidateQueries({ queryKey: ["list", listId] });
      qc.invalidateQueries({ queryKey: ["credits"] });
      toast({ variant: "success", title: "Deep scan complete", description: `${result.email} → ${result.status}` });
    },
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const openRecord = (r: EmailRecord) => {
    setSelected(r);
    setDrawerOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email…" className="pl-9" />
        </div>
        <Button variant="outline" size="sm" onClick={() => toast({ variant: "info", title: "Export started", description: "Your file will be ready shortly." })}>
          <Download className="size-4" /> Export
        </Button>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => {
              setStatus(f);
              setPage(1);
            }}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              status === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))
            ) : data && data.records.length ? (
              data.records.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => openRecord(r)}>
                  <TableCell className="font-medium">{r.email}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.firstName ? `${r.firstName} ${r.lastName ?? ""}` : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.company ?? "—"}</TableCell>
                  <TableCell>{r.result && <StatusBadge status={r.result.status} />}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{r.result?.score ?? "—"}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu
                      trigger={<Button size="sm" variant="ghost">•••</Button>}
                    >
                      <DropdownItem onClick={() => openRecord(r)}>View details</DropdownItem>
                      <DropdownItem
                        onClick={() => {
                          setSelected(r);
                          setDrawerOpen(true);
                          deepScan.mutate(r);
                        }}
                      >
                        <Sparkles /> Deep scan
                      </DropdownItem>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  No emails match your filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {formatNumber(data.total)} result{data.total === 1 ? "" : "s"}
            {isFetching && " · updating…"}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="size-4" /> Prev
            </Button>
            <span className="tabular-nums">Page {page} / {totalPages}</span>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <DetailDrawer
        record={selected}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onDeepScan={(r) => deepScan.mutate(r)}
        deepScanning={deepScan.isPending}
      />
    </div>
  );
}

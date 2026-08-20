"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MoreHorizontal, Eye, Download, Pencil, Trash2, RefreshCw, FileDown, Loader2, Mail, User, Building2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { formatNumber, formatDate, cn } from "@/lib/utils";
import { runEnrichTable, renameEnrichTable, deleteEnrichTable, enrichExportUrl, ApiError } from "@/lib/api/client";
import type { EnrichmentTable, EnrichStatus } from "@/lib/types";

const STATUS_STYLES: Record<EnrichStatus, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-primary/10 text-primary" },
  enriching: { label: "Enriching", className: "bg-risky/12 text-[hsl(var(--risky))]" },
  completed: { label: "Completed", className: "bg-valid/12 text-[hsl(var(--valid))]" },
  failed: { label: "Failed", className: "bg-invalid/12 text-[hsl(var(--invalid))]" },
};

function download(url: string) {
  const a = document.createElement("a");
  a.href = url; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}

export function EnrichJobsTable({ tables }: { tables: EnrichmentTable[] }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [renameTarget, setRenameTarget] = React.useState<EnrichmentTable | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<EnrichmentTable | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["enrich-tables"] });
    qc.invalidateQueries({ queryKey: ["credits"] });
  };

  const rerun = useMutation({
    mutationFn: (id: string) => runEnrichTable(id),
    onMutate: (id) => setBusyId(id),
    onSuccess: (t) => { invalidate(); qc.invalidateQueries({ queryKey: ["enrich-table", t.id] }); toast({ variant: "info", title: "Re-running", description: `${t.name} is enriching.` }); },
    onError: (err) => toast({ variant: "error", title: err instanceof ApiError && err.code === "INSUFFICIENT_CREDITS" ? "Insufficient credits" : "Could not re-run" }),
    onSettled: () => setBusyId(null),
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameEnrichTable(id, name),
    onSuccess: (t) => { invalidate(); qc.invalidateQueries({ queryKey: ["enrich-table", t.id] }); setRenameTarget(null); toast({ variant: "success", title: "Table renamed" }); },
    onError: () => toast({ variant: "error", title: "Could not rename" }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteEnrichTable(id),
    onSuccess: () => { invalidate(); setDeleteTarget(null); toast({ variant: "success", title: "Table deleted" }); },
    onError: () => toast({ variant: "error", title: "Could not delete" }),
  });

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Table</TableHead>
            <TableHead className="text-right">Rows</TableHead>
            <TableHead className="text-right">Columns</TableHead>
            <TableHead>Progress</TableHead>
            <TableHead className="text-right">Emails</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tables.map((t) => {
            const s = STATUS_STYLES[t.status];
            const busy = busyId === t.id;
            const TypeIcon = t.recordType === "people" ? User : Building2;
            return (
              <TableRow key={t.id} className="cursor-pointer" onClick={() => router.push(`/enrich/${t.id}`)}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <TypeIcon className="size-4 text-muted-foreground" />
                    <div>
                      <Link href={`/enrich/${t.id}`} className="font-medium hover:text-primary" onClick={(e) => e.stopPropagation()}>{t.name}</Link>
                      <p className="text-xs text-muted-foreground">{formatDate(t.createdAt)} · {t.recordType}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(t.summary.rows)}</TableCell>
                <TableCell className="text-right tabular-nums">{t.columns.length}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress value={t.progress} className="w-20" />
                    <span className="text-sm tabular-nums text-muted-foreground">{t.progress}%</span>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <span className="inline-flex items-center gap-1"><Mail className="size-3.5 text-muted-foreground" />{formatNumber(t.summary.emailsFound)}</span>
                </TableCell>
                <TableCell><Badge className={cn("border-transparent", s.className)}>{s.label}</Badge></TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => router.push(`/enrich/${t.id}`)}><Eye className="size-4" /> Open</Button>
                    <DropdownMenu trigger={<Button size="icon" variant="ghost" aria-label="More actions" disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}</Button>}>
                      <DropdownItem onClick={() => router.push(`/enrich/${t.id}`)}><Eye /> Open table</DropdownItem>
                      <DropdownItem onClick={() => rerun.mutate(t.id)}><RefreshCw /> Re-run all</DropdownItem>
                      <DropdownSeparator />
                      <DropdownItem onClick={() => download(enrichExportUrl(t.id, "csv"))}><Download /> Export CSV</DropdownItem>
                      <DropdownItem onClick={() => download(enrichExportUrl(t.id, "xlsx"))}><FileDown /> Export XLSX</DropdownItem>
                      <DropdownItem onClick={() => { setRenameTarget(t); setRenameValue(t.name); }}><Pencil /> Rename</DropdownItem>
                      <DropdownSeparator />
                      <DropdownItem destructive onClick={() => setDeleteTarget(t)}><Trash2 /> Delete</DropdownItem>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogHeader><DialogTitle>Rename table</DialogTitle><DialogDescription>Give this enrichment table a clearer name.</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label>Table name</Label>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus onKeyDown={(e) => e.key === "Enter" && renameTarget && renameValue.trim() && rename.mutate({ id: renameTarget.id, name: renameValue.trim() })} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
          <Button disabled={!renameValue.trim() || rename.isPending} onClick={() => renameTarget && rename.mutate({ id: renameTarget.id, name: renameValue.trim() })}>{rename.isPending ? <Loader2 className="size-4 animate-spin" /> : "Save"}</Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogHeader><DialogTitle>Delete table?</DialogTitle><DialogDescription>{deleteTarget && `"${deleteTarget.name}" and its ${formatNumber(deleteTarget.summary.rows)} rows will be permanently removed.`}</DialogDescription></DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}>{remove.isPending ? <Loader2 className="size-4 animate-spin" /> : "Delete"}</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

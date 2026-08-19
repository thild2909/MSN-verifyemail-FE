"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MoreHorizontal, Eye, Download, Pencil, Trash2, RefreshCw, FileDown, Loader2,
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
import { reprocessList, renameList, deleteList, listExportUrl, ApiError } from "@/lib/api/client";
import { safeToSendRate, type EmailList, type ListStatus } from "@/lib/types";

const STATUS_STYLES: Record<ListStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  queued: { label: "Queued", className: "bg-primary/10 text-primary" },
  processing: { label: "Processing", className: "bg-risky/12 text-[hsl(var(--risky))]" },
  completed: { label: "Completed", className: "bg-valid/12 text-[hsl(var(--valid))]" },
  failed: { label: "Failed", className: "bg-invalid/12 text-[hsl(var(--invalid))]" },
};

function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function SafeToSendCell({ list }: { list: EmailList }) {
  const rate = safeToSendRate(list.summary);
  const tone = rate >= 65 ? "bg-[hsl(var(--valid))]" : rate >= 45 ? "bg-[hsl(var(--risky))]" : "bg-[hsl(var(--invalid))]";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${rate}%` }} />
      </div>
      <span className="text-sm font-medium tabular-nums">{rate}%</span>
    </div>
  );
}

export function ListsTable({ lists }: { lists: EmailList[] }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [renameTarget, setRenameTarget] = React.useState<EmailList | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<EmailList | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["lists"] });
    qc.invalidateQueries({ queryKey: ["credits"] });
  };

  const reprocess = useMutation({
    mutationFn: (id: string) => reprocessList(id),
    onMutate: (id) => setBusyId(id),
    onSuccess: (list) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["list", list.id] });
      toast({ variant: "info", title: "Re-verifying list", description: `${list.name} is processing on the server.` });
    },
    onError: (err) =>
      toast({
        variant: "error",
        title: err instanceof ApiError && err.code === "INSUFFICIENT_CREDITS" ? "Insufficient credits" : "Could not reprocess",
      }),
    onSettled: () => setBusyId(null),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameList(id, name),
    onSuccess: (list) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["list", list.id] });
      setRenameTarget(null);
      toast({ variant: "success", title: "List renamed" });
    },
    onError: () => toast({ variant: "error", title: "Could not rename" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteList(id),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
      toast({ variant: "success", title: "List deleted" });
    },
    onError: () => toast({ variant: "error", title: "Could not delete" }),
  });

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>List</TableHead>
            <TableHead className="text-right">Unique emails</TableHead>
            <TableHead>Progress</TableHead>
            <TableHead>Safe to send</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lists.map((list) => {
            const s = STATUS_STYLES[list.status];
            const busy = busyId === list.id;
            return (
              <TableRow key={list.id} className="cursor-pointer" onClick={() => router.push(`/verification/lists/${list.id}`)}>
                <TableCell>
                  <Link href={`/verification/lists/${list.id}`} className="font-medium hover:text-primary" onClick={(e) => e.stopPropagation()}>
                    {list.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{formatDate(list.createdAt)}</p>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(list.uniqueEmails)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress value={list.progress} className="w-20" />
                    <span className="text-sm tabular-nums text-muted-foreground">{list.progress}%</span>
                  </div>
                </TableCell>
                <TableCell><SafeToSendCell list={list} /></TableCell>
                <TableCell><Badge className={cn("border-transparent", s.className)}>{s.label}</Badge></TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => router.push(`/verification/lists/${list.id}`)}>
                      <Eye className="size-4" /> View
                    </Button>
                    <DropdownMenu
                      trigger={
                        <Button size="icon" variant="ghost" aria-label="More actions" disabled={busy}>
                          {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
                        </Button>
                      }
                    >
                      <DropdownItem onClick={() => router.push(`/verification/lists/${list.id}`)}>
                        <Eye /> View details
                      </DropdownItem>
                      <DropdownItem onClick={() => reprocess.mutate(list.id)}>
                        <RefreshCw /> Re-verify list
                      </DropdownItem>
                      <DropdownSeparator />
                      <DropdownItem onClick={() => download(listExportUrl(list.id, "csv"))}>
                        <Download /> Download CSV
                      </DropdownItem>
                      <DropdownItem onClick={() => download(listExportUrl(list.id, "xlsx"))}>
                        <FileDown /> Export XLSX
                      </DropdownItem>
                      <DropdownItem
                        onClick={() => {
                          setRenameTarget(list);
                          setRenameValue(list.name);
                        }}
                      >
                        <Pencil /> Rename
                      </DropdownItem>
                      <DropdownSeparator />
                      <DropdownItem destructive onClick={() => setDeleteTarget(list)}>
                        <Trash2 /> Delete
                      </DropdownItem>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogHeader>
          <DialogTitle>Rename list</DialogTitle>
          <DialogDescription>Give this list a clearer name.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>List name</Label>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && renameTarget && renameValue.trim() && rename.mutate({ id: renameTarget.id, name: renameValue.trim() })}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
          <Button
            disabled={!renameValue.trim() || rename.isPending}
            onClick={() => renameTarget && rename.mutate({ id: renameTarget.id, name: renameValue.trim() })}
          >
            {rename.isPending ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogHeader>
          <DialogTitle>Delete list?</DialogTitle>
          <DialogDescription>
            {deleteTarget && `"${deleteTarget.name}" and its ${formatNumber(deleteTarget.uniqueEmails)} records will be permanently removed.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}>
            {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : "Delete"}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

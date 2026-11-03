"use client";
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Users, Building2, ListChecks, Bookmark, Pencil, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { IconTile, Pill } from "@/components/common/kit";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { SavedListItemsTable } from "@/components/leads/saved-list-items-table";
import { useToast } from "@/components/ui/toast";
import { getLeadLists, renameLeadList, deleteLeadList } from "@/lib/api/client";
import { formatNumber, formatDate, cn } from "@/lib/utils";

export default function SavedListDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["lead-lists"], queryFn: getLeadLists });
  const list = data?.find((l) => l.id === params.id);

  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameName, setRenameName] = React.useState("");
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [tab, setTab] = React.useState<"person" | "company">("person");
  const pickedRef = React.useRef(false);
  React.useEffect(() => {
    if (list && !pickedRef.current) {
      pickedRef.current = true;
      if (list.summary.people === 0 && list.summary.companies > 0) setTab("company");
    }
  }, [list]);

  const renameMut = useMutation({
    mutationFn: (name: string) => renameLeadList(params.id, name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lead-lists"] }); setRenameOpen(false); toast({ variant: "success", title: "List renamed" }); },
    onError: () => toast({ variant: "error", title: "Could not rename list" }),
  });
  const deleteMut = useMutation({
    mutationFn: () => deleteLeadList(params.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lead-lists"] }); toast({ variant: "success", title: "List deleted" }); router.push("/lists"); },
    onError: () => { setDeleteOpen(false); toast({ variant: "error", title: "Could not delete list" }); },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="min-h-0 flex-1 w-full" />
      </div>
    );
  }

  if (!list) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
        <p className="text-lg font-semibold">List not found</p>
        <Link href="/lists" className={cn(buttonVariants({ variant: "outline" }))}>Back to lists</Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="bg-card px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="flex flex-wrap items-start gap-3">
          <Link
            href="/lists"
            aria-label="Back to lists"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-xs transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <IconTile icon={list.isSaved ? Bookmark : ListChecks} tone="brand" className="hidden sm:flex" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-words text-xl font-semibold tracking-tight">{list.name}</h1>
              {list.isSaved && <Pill tone="brand">Default</Pill>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span><span className="font-semibold tabular-nums text-foreground">{formatNumber(list.summary.total)}</span> leads</span>
              <span className="inline-flex items-center gap-1"><Users className="size-3.5" /> {formatNumber(list.summary.people)} people</span>
              <span className="inline-flex items-center gap-1"><Building2 className="size-3.5" /> {formatNumber(list.summary.companies)} companies</span>
              <span>Updated {formatDate(list.updatedAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { setRenameName(list.name); setRenameOpen(true); }}><Pencil /> Rename</Button>
            {!list.isSaved && (
              <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                <Trash2 /> Delete
              </Button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div role="tablist" className="mt-4 flex items-center gap-1 overflow-x-auto border-b border-border no-scrollbar">
          <TabBtn active={tab === "person"} onClick={() => setTab("person")} icon={Users} label="People leads" count={list.summary.people} />
          <TabBtn active={tab === "company"} onClick={() => setTab("company")} icon={Building2} label="Company leads" count={list.summary.companies} />
        </div>
      </div>

      {/* Table fills the rest of the screen */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* key={tab} remounts the table per kind so selection/search reset cleanly. */}
        <SavedListItemsTable key={tab} listId={list.id} listName={list.name} kind={tab} />
      </div>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={(o) => !o && setRenameOpen(false)}>
        <DialogHeader><DialogTitle>Rename list</DialogTitle></DialogHeader>
        <Input autoFocus value={renameName} onChange={(e) => setRenameName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && renameName.trim()) renameMut.mutate(renameName.trim()); }} placeholder="List name" />
        <DialogFooter>
          <Button variant="outline" onClick={() => setRenameOpen(false)}>Cancel</Button>
          <Button disabled={!renameName.trim() || renameMut.isPending} onClick={() => renameMut.mutate(renameName.trim())}>Save</Button>
        </DialogFooter>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleteOpen} onOpenChange={(o) => !o && setDeleteOpen(false)}>
        <DialogHeader>
          <DialogTitle>Delete list</DialogTitle>
          <DialogDescription>Delete “{list.name}” and its {formatNumber(list.summary.total)} saved {list.summary.total === 1 ? "lead" : "leads"}? This can’t be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button variant="destructive" disabled={deleteMut.isPending} onClick={() => deleteMut.mutate()}>Delete</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label, count }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string; count: number }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "-mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
        active ? "border-brand bg-brand/[0.04] text-brand" : "border-transparent text-foreground/75 hover:text-foreground",
      )}
    >
      <Icon className="size-4" strokeWidth={1.75} /> {label}
      <span className={cn("rounded px-1.5 text-[11px] font-semibold tabular-nums", active ? "bg-brand/10 text-brand" : "bg-surface text-muted-foreground")}>{formatNumber(count)}</span>
    </button>
  );
}

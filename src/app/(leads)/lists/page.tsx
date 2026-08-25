"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Inbox, Radar, MoreHorizontal, Pencil, Trash2, Users, Building2, Bookmark } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { getLeadLists, createLeadList, renameLeadList, deleteLeadList, type LeadList } from "@/lib/api/client";
import { formatNumber, formatDate, cn } from "@/lib/utils";

export default function SavedListsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["lead-lists"], queryFn: getLeadLists });
  const [search, setSearch] = React.useState("");

  const [newOpen, setNewOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [renaming, setRenaming] = React.useState<LeadList | null>(null);
  const [renameName, setRenameName] = React.useState("");
  const [deleting, setDeleting] = React.useState<LeadList | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["lead-lists"] });

  const createMut = useMutation({
    mutationFn: (name: string) => createLeadList(name),
    onSuccess: (l) => { invalidate(); setNewOpen(false); setNewName(""); toast({ variant: "success", title: `Created “${l.name}”` }); },
    onError: () => toast({ variant: "error", title: "Could not create list" }),
  });
  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameLeadList(id, name),
    onSuccess: () => { invalidate(); setRenaming(null); toast({ variant: "success", title: "List renamed" }); },
    onError: () => toast({ variant: "error", title: "Could not rename list" }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteLeadList(id),
    onSuccess: () => { invalidate(); setDeleting(null); toast({ variant: "success", title: "List deleted" }); },
    onError: () => toast({ variant: "error", title: "Could not delete list" }),
  });

  const filtered = React.useMemo(
    () => (data ?? []).filter((l) => l.name.toLowerCase().includes(search.toLowerCase())),
    [data, search],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Saved Lists"
        subtitle="People and companies you saved from Find Leads."
        actions={<Button onClick={() => { setNewName(""); setNewOpen(true); }}><Plus className="size-4" /> New list</Button>}
      />

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search lists…" className="pl-9" />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 w-full" />)}
        </div>
      ) : filtered.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((l) => (
            <ListCard
              key={l.id}
              list={l}
              onRename={() => { setRenameName(l.name); setRenaming(l); }}
              onDelete={() => setDeleting(l)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={search ? Search : Inbox}
          title={search ? "No lists match" : "No saved lists yet"}
          description={search ? "Try a different search." : "Save people or companies from Find Leads to build a list."}
          action={search ? undefined : <Link href="/find-leads" className={buttonVariants()}><Radar className="size-4" /> Find leads</Link>}
        />
      )}

      {/* New list dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogHeader>
          <DialogTitle>New list</DialogTitle>
          <DialogDescription>Create an empty list to organize saved leads.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) createMut.mutate(newName.trim()); }}
          placeholder="List name"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
          <Button disabled={!newName.trim() || createMut.isPending} onClick={() => createMut.mutate(newName.trim())}>Create</Button>
        </DialogFooter>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogHeader><DialogTitle>Rename list</DialogTitle></DialogHeader>
        <Input
          autoFocus
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && renameName.trim() && renaming) renameMut.mutate({ id: renaming.id, name: renameName.trim() }); }}
          placeholder="List name"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
          <Button disabled={!renameName.trim() || renameMut.isPending} onClick={() => renaming && renameMut.mutate({ id: renaming.id, name: renameName.trim() })}>Save</Button>
        </DialogFooter>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogHeader>
          <DialogTitle>Delete list</DialogTitle>
          <DialogDescription>
            Delete “{deleting?.name}” and its {formatNumber(deleting?.summary.total ?? 0)} saved {deleting?.summary.total === 1 ? "lead" : "leads"}? This can’t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="destructive" disabled={deleteMut.isPending} onClick={() => deleting && deleteMut.mutate(deleting.id)}>Delete</Button>
        </DialogFooter>
      </Dialog>
      </div>
    </div>
  );
}

function ListCard({ list, onRename, onDelete }: { list: LeadList; onRename: () => void; onDelete: () => void }) {
  return (
    <Card className="group relative transition-colors hover:border-primary/40">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/lists/${list.id}`} className="flex min-w-0 items-center gap-2">
            {list.isSaved
              ? <Bookmark className="size-4 shrink-0 text-primary" />
              : <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-xs font-semibold text-primary">{list.name.slice(0, 2).toUpperCase()}</span>}
            <span className="truncate font-semibold">{list.name}</span>
          </Link>
          <DropdownMenu align="end" trigger={<button className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label="List options"><MoreHorizontal className="size-4" /></button>}>
            <DropdownItem onClick={onRename}><Pencil className="size-4" /> Rename</DropdownItem>
            {!list.isSaved && (
              <>
                <DropdownSeparator />
                <DropdownItem onClick={onDelete} destructive><Trash2 className="size-4" /> Delete</DropdownItem>
              </>
            )}
          </DropdownMenu>
        </div>

        <Link href={`/lists/${list.id}`} className="mt-4 block">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-2xl font-bold tabular-nums">{formatNumber(list.summary.total)}</span>
            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Users className="size-3.5" /> {formatNumber(list.summary.people)} people</span>
              <span className="inline-flex items-center gap-1.5"><Building2 className="size-3.5" /> {formatNumber(list.summary.companies)} companies</span>
            </div>
          </div>
          <p className={cn("mt-3 text-xs text-muted-foreground")}>Updated {formatDate(list.updatedAt)}</p>
        </Link>
      </CardContent>
    </Card>
  );
}

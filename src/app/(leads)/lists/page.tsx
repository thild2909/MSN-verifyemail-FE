"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Inbox, Radar, MoreHorizontal, Pencil, Trash2, Users, Building2, Bookmark, ListChecks, Layers, ArrowUpRight } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { IconTile, Pill, TONES, avatarTone, type Tone } from "@/components/common/kit";
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

  const all = data ?? [];
  const totals = {
    lists: all.length,
    leads: all.reduce((n, l) => n + l.summary.total, 0),
    people: all.reduce((n, l) => n + l.summary.people, 0),
    companies: all.reduce((n, l) => n + l.summary.companies, 0),
  };
  const openNew = () => { setNewName(""); setNewOpen(true); };

  return (
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
      <div className="mx-auto max-w-[1440px] space-y-6 p-4 lg:px-8 lg:py-7">
      <PageHeader
        title="Saved lists"
        subtitle="People and companies you saved from Find Leads."
        actions={
          <>
            <Link href="/find-leads" className={buttonVariants({ variant: "outline" })}><Radar /> Find leads</Link>
            <Button onClick={openNew}><Plus /> New list</Button>
          </>
        }
      />

      {/* Summary strip */}
      <Card className="grid grid-cols-2 divide-border lg:grid-cols-4 lg:divide-x">
        {[
          { label: "Lists", value: totals.lists, icon: ListChecks, tone: "brand" as Tone },
          { label: "Saved leads", value: totals.leads, icon: Layers, tone: "violet" as Tone },
          { label: "People", value: totals.people, icon: Users, tone: "sky" as Tone },
          { label: "Companies", value: totals.companies, icon: Building2, tone: "risky" as Tone },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
            <IconTile icon={s.icon} tone={s.tone} className="rounded-full" />
            <div>
              <p className="text-[13px] text-muted-foreground">{s.label}</p>
              <p className="text-[15px] font-semibold tabular-nums">{isLoading ? "…" : formatNumber(s.value)}</p>
            </div>
          </div>
        ))}
      </Card>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search lists"
            className="pl-9"
            type="search"
            name="list-filter"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
          />
        </div>
        {!isLoading && (
          <p className="text-xs text-muted-foreground">
            {search ? `${filtered.length} of ${all.length} lists` : `${all.length} list${all.length === 1 ? "" : "s"}`}
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 w-full rounded-xl" />)}
        </div>
      ) : filtered.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((l) => (
            <ListCard
              key={l.id}
              list={l}
              onRename={() => { setRenameName(l.name); setRenaming(l); }}
              onDelete={() => setDeleting(l)}
            />
          ))}
          {!search && (
            <button
              onClick={openNew}
              className="group flex min-h-[11rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/50 text-muted-foreground transition-colors hover:border-brand/50 hover:text-brand"
            >
              <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-card shadow-xs transition-colors group-hover:border-brand/40">
                <Plus className="size-5" />
              </span>
              <span className="text-sm font-medium">New list</span>
            </button>
          )}
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
  const { total, people, companies } = list.summary;
  // Shares are of people + companies (the two kinds a list holds), so the bar
  // always sums to 100% even when `total` counts something differently.
  const parts = people + companies;
  const peoplePct = parts > 0 ? (people / parts) * 100 : 0;
  const companyPct = parts > 0 ? 100 - peoplePct : 0;
  const PEOPLE_C = "hsl(234 78% 60%)";
  const COMPANY_C = "hsl(280 62% 55%)";
  return (
    <Card className="group relative flex min-w-0 flex-col transition-all hover:border-brand/40 hover:shadow-pop">
      <div className="flex items-start justify-between gap-2 p-4 pb-0">
        <Link href={`/lists/${list.id}`} className="flex min-w-0 items-start gap-3">
          {list.isSaved ? (
            <IconTile icon={Bookmark} tone="brand" />
          ) : (
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg text-xs font-semibold", TONES[avatarTone(list.name)])}>
              {list.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <span className="min-w-0">
            {/* Wrap long names onto multiple lines (no ellipsis). */}
            <span className="block break-words text-[15px] font-semibold leading-snug">{list.name}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              {list.isSaved && <Pill tone="brand" className="py-0">Default</Pill>}
              Updated {formatDate(list.updatedAt)}
            </span>
          </span>
        </Link>
        <DropdownMenu
          align="end"
          trigger={
            <button className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground" aria-label="List options">
              <MoreHorizontal className="size-4" />
            </button>
          }
        >
          <DropdownItem onClick={onRename}><Pencil /> Rename</DropdownItem>
          {!list.isSaved && (
            <>
              <DropdownSeparator />
              <DropdownItem onClick={onDelete} destructive><Trash2 /> Delete</DropdownItem>
            </>
          )}
        </DropdownMenu>
      </div>

      <Link href={`/lists/${list.id}`} className="mt-auto block p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums">{formatNumber(total)}</span>
            <span className="text-sm text-muted-foreground">lead{total === 1 ? "" : "s"}</span>
          </div>
          {/* Open affordance — its own chip in the free space, never over text. */}
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground transition-all group-hover:border-brand/40 group-hover:bg-brand/10 group-hover:text-brand">
            <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
          </span>
        </div>

        {/* Composition: people vs companies */}
        {parts > 0 ? (
          <div className="mt-3 flex h-2 gap-[3px]" role="img" aria-label={`${Math.round(peoplePct)}% people, ${Math.round(companyPct)}% companies`}>
            {people > 0 && <div className="h-full rounded-full transition-all" style={{ width: `${peoplePct}%`, background: PEOPLE_C }} />}
            {companies > 0 && <div className="h-full rounded-full transition-all" style={{ width: `${companyPct}%`, background: COMPANY_C }} />}
          </div>
        ) : (
          <div className="mt-3 flex h-2 items-center rounded-full border border-dashed border-border" aria-label="Empty list" />
        )}

        <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
          <span className="flex min-w-0 items-center gap-2 rounded-md bg-surface/70 px-2 py-1.5">
            <Users className="size-3.5 shrink-0" style={{ color: PEOPLE_C }} />
            <span className="font-semibold tabular-nums text-foreground">{formatNumber(people)}</span>
            <span className="truncate text-muted-foreground">people</span>
            {parts > 0 && <span className="ml-auto tabular-nums text-muted-foreground">{Math.round(peoplePct)}%</span>}
          </span>
          <span className="flex min-w-0 items-center gap-2 rounded-md bg-surface/70 px-2 py-1.5">
            <Building2 className="size-3.5 shrink-0" style={{ color: COMPANY_C }} />
            <span className="font-semibold tabular-nums text-foreground">{formatNumber(companies)}</span>
            <span className="truncate text-muted-foreground">companies</span>
            {parts > 0 && <span className="ml-auto tabular-nums text-muted-foreground">{Math.round(companyPct)}%</span>}
          </span>
        </div>
        {parts === 0 && <p className="mt-2 text-center text-[11px] text-muted-foreground">Empty list</p>}
      </Link>
    </Card>
  );
}

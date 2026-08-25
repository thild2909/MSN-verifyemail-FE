"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Inbox, Loader2, ChevronRight, Database, ChevronDown, ListPlus, Download, Users, X, Plus, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { getCollectedCompanies, getLeadLists, createLeadList, addLeadItems } from "@/lib/api/client";
import { formatNumber, cn } from "@/lib/utils";
import { companyToLeadItem, addToListToast } from "@/lib/leads/lead-snapshot";
import { toCsv, downloadCsv } from "@/lib/leads/csv";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sourced, COLLECT_STATUS_META, VerificationBadge, CompanyLogo, LlmBadge } from "./collect-ui";
import { CompanyFilterPanel } from "./company-filter-panel";
import { MobileFilterDrawer, openFiltersFor } from "./filter-drawer";
import { EMPTY_COMPANY_FILTERS, countCompanyFilters, type CompanyFilters, type CollectedCompany } from "@/lib/leads/collect-types";

const PAGE_SIZE = 25;

export interface FindPeoplePayload {
  companyIds?: string[];
  allMatching?: boolean;
  search?: string;
  filters?: CompanyFilters;
  count: number;
}

interface Props {
  jobId: string;
  jobName?: string;
  live: boolean;
  onOpenCompany: (c: CollectedCompany) => void;
  onFindPeople: (payload: FindPeoplePayload) => void;
  findingPeople?: boolean;
}

/** Small square checkbox matching the People table. */
function Check({ checked, indeterminate, onChange }: { checked: boolean; indeterminate?: boolean; onChange: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      className={cn(
        "flex size-4 items-center justify-center rounded border transition-colors",
        checked || indeterminate ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:border-primary/50",
      )}
    >
      {indeterminate ? (
        <span className="h-0.5 w-2 rounded bg-current" />
      ) : checked ? (
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </button>
  );
}

export function CollectedCompaniesTable({ jobId, jobName, live, onOpenCompany, onFindPeople, findingPeople }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<CompanyFilters>(EMPTY_COMPANY_FILTERS);
  const [showFilters, setShowFilters] = React.useState(true);
  const [mobileFilters, setMobileFilters] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);
  const filterKey = JSON.stringify(filters);
  React.useEffect(() => { setPage(1); }, [debounced, filterKey]);

  // Selection: explicit ids, or "all matching the current filter".
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = React.useState(false);
  // Reset selection when the job or filter changes.
  React.useEffect(() => { setSelectedIds(new Set()); setAllMatching(false); }, [jobId, debounced, filterKey]);

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["collect-companies", jobId, debounced, filterKey, page],
    queryFn: () => getCollectedCompanies(jobId, { search: debounced, ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
    refetchInterval: live ? 1500 : false,
  });

  const rows = data?.companies ?? [];
  const facets = data?.facets;
  const filtersActive = countCompanyFilters(filters);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageIds = rows.map((r) => r.id);

  const effectiveCount = allMatching ? total : selectedIds.size;
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => allMatching || selectedIds.has(id));
  const someSelected = effectiveCount > 0;

  const rowChecked = (id: string) => allMatching || selectedIds.has(id);
  const toggleRow = (id: string) => {
    if (allMatching) {
      // Drop out of "all" mode into an explicit selection of the rest of this page.
      setAllMatching(false);
      setSelectedIds(new Set(pageIds.filter((x) => x !== id)));
      return;
    }
    setSelectedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const selectThisPage = () => { setAllMatching(false); setSelectedIds((s) => { const n = new Set(s); pageIds.forEach((id) => n.add(id)); return n; }); };
  const selectAll = () => { setSelectedIds(new Set()); setAllMatching(true); };
  const clearSelection = () => { setSelectedIds(new Set()); setAllMatching(false); };
  const toggleHeader = () => { if (someSelected) clearSelection(); else selectThisPage(); };

  /** Resolve the full CollectedCompany rows behind the current selection. */
  const resolveSelected = React.useCallback(async (): Promise<CollectedCompany[]> => {
    const all = await getCollectedCompanies(jobId, { search: debounced, ...filters, page: 1, pageSize: 100000 });
    return allMatching ? all.companies : all.companies.filter((c) => selectedIds.has(c.id));
  }, [jobId, debounced, filterKey, allMatching, selectedIds]);

  const [busy, setBusy] = React.useState<null | "export" | "list">(null);

  const onExport = async () => {
    setBusy("export");
    try {
      const sel = await resolveSelected();
      const headers = ["Company", "Employees", "Industry", "Website", "Email", "Phone", "LinkedIn", "Location"];
      const csv = toCsv(headers, sel.map((c) => [
        c.inputName, c.employees?.value ?? "", c.industry?.value ?? "", c.website?.value ?? "",
        c.contactEmail?.value ?? "", c.phone?.value ?? "", c.linkedin?.value ?? "", c.address?.value ?? c.inputLocation,
      ]));
      downloadCsv(jobName?.trim() || `companies-${jobId}`, csv);
      toast({ variant: "success", title: `Exported ${formatNumber(sel.length)} companies` });
    } catch { toast({ variant: "error", title: "Export failed" }); }
    finally { setBusy(null); }
  };

  const listItems = (rows: CollectedCompany[]) => rows.map((c) => companyToLeadItem(c, jobId));

  const addSelectedToList = async (listId: string, listName: string) => {
    setBusy("list");
    try {
      const sel = await resolveSelected();
      if (sel.length === 0) { toast({ variant: "info", title: "Nothing selected" }); return; }
      const { added, skipped } = await addLeadItems(listId, listItems(sel));
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
      toast(addToListToast(added, skipped, listName));
    }
    catch { toast({ variant: "error", title: "Could not add to list" }); }
    finally { setBusy(null); }
  };

  // "New list" opens a naming dialog (same as /lists), then adds the selection.
  const [newListOpen, setNewListOpen] = React.useState(false);
  const [newListName, setNewListName] = React.useState("");
  const createAndAdd = async () => {
    const name = newListName.trim();
    if (!name) return;
    setBusy("list");
    try {
      const sel = await resolveSelected();
      if (sel.length === 0) { toast({ variant: "info", title: "Nothing selected" }); setNewListOpen(false); return; }
      const list = await createLeadList(name);
      const { added, skipped } = await addLeadItems(list.id, listItems(sel));
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
      setNewListOpen(false); setNewListName("");
      toast(addToListToast(added, skipped, list.name));
    }
    catch { toast({ variant: "error", title: "Could not create list" }); }
    finally { setBusy(null); }
  };

  const { data: lists = [] } = useQuery({ queryKey: ["lead-lists"], queryFn: getLeadLists });

  const findPeople = () => onFindPeople(
    allMatching
      ? { allMatching: true, search: debounced, filters, count: effectiveCount }
      : { companyIds: [...selectedIds], count: effectiveCount },
  );

  return (
    <div className="flex min-h-0 flex-1">
      {showFilters && (
        <aside className="hidden w-64 shrink-0 flex-col overflow-hidden border-r bg-muted/10 md:flex">
          <CompanyFilterPanel filters={filters} facets={facets} onChange={setFilters} onClear={() => setFilters(EMPTY_COMPANY_FILTERS)} />
        </aside>
      )}
      <MobileFilterDrawer open={mobileFilters} onClose={() => setMobileFilters(false)}>
        <CompanyFilterPanel filters={filters} facets={facets} onChange={setFilters} onClear={() => setFilters(EMPTY_COMPANY_FILTERS)} />
      </MobileFilterDrawer>
      <div className="relative flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="relative w-full min-w-[200px] sm:w-auto sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company or location…" className="h-9 pl-9" />
        </div>
        <span className="text-sm text-muted-foreground"><span className="font-semibold text-foreground tabular-nums">{formatNumber(total)}</span> companies</span>
        <Button size="sm" variant={showFilters ? "secondary" : "outline"} className="ml-auto h-9" onClick={() => openFiltersFor(setShowFilters, setMobileFilters)}>
          <SlidersHorizontal className="size-4" /> Filters{filtersActive > 0 && <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">{filtersActive}</span>}
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : total === 0 ? (
          <EmptyState icon={Inbox} title="No companies match" description="Try clearing the search or filter." className="m-6" />
        ) : (
          <div className={cn("scrollbar-thin h-full overflow-auto transition-opacity", isPlaceholderData && "opacity-60")}>
            <table className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="w-10 px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <Check checked={allMatching || allPageSelected} indeterminate={someSelected && !allMatching && !allPageSelected} onChange={toggleHeader} />
                      <DropdownMenu align="start" trigger={<button className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Selection options"><ChevronDown className="size-3.5" /></button>}>
                        <DropdownItem onClick={selectThisPage}>Select this page ({pageIds.length})</DropdownItem>
                        <DropdownItem onClick={selectAll}>Select all {formatNumber(total)}</DropdownItem>
                        {someSelected && <><DropdownSeparator /><DropdownItem onClick={clearSelection}>Clear selection</DropdownItem></>}
                      </DropdownMenu>
                    </div>
                  </th>
                  <th className="px-3 py-2.5 font-medium">Company</th>
                  <th className="px-3 py-2.5 font-medium">Employees</th>
                  <th className="px-3 py-2.5 font-medium">Industry</th>
                  <th className="px-3 py-2.5 font-medium">Website</th>
                  <th className="px-3 py-2.5 font-medium">Email</th>
                  <th className="px-3 py-2.5 font-medium">Phone</th>
                  <th className="px-3 py-2.5 font-medium">LinkedIn</th>
                  <th className="px-3 py-2.5 font-medium">Location</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const st = COLLECT_STATUS_META[c.status];
                  const emailField = c.contactEmail;
                  const selected = rowChecked(c.id);
                  return (
                    <tr key={c.id} onClick={() => onOpenCompany(c)} className={cn("cursor-pointer border-b hover:bg-muted/30", selected && "bg-primary/[0.04]")}>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <Check checked={selected} onChange={() => toggleRow(c.id)} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <CompanyLogo domain={c.domainGuess} text={c.logoText || c.inputName.slice(0, 2).toUpperCase()} className="size-8 text-[11px]" />
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 truncate font-medium">
                              {c.inputName}
                              {c.resolution?.cacheHit && <Database className="size-3 shrink-0 text-muted-foreground" aria-label="Served from cache" />}
                              {c.llmVerification && <LlmBadge v={c.llmVerification} />}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {c.inputLocation}{c.domainGuess ? ` · ${c.domainGuess}` : ""}
                              {c.resolution && c.resolution.confidence > 0 ? ` · ${c.resolution.confidence}% match` : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2"><Sourced field={c.employees} showConfidence /></td>
                      <td className="px-3 py-2"><Sourced field={c.industry} /></td>
                      <td className="px-3 py-2"><Sourced field={c.website} /></td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <Sourced field={emailField} />
                          {c.emailVerification && <VerificationBadge ev={c.emailVerification} />}
                        </div>
                      </td>
                      <td className="px-3 py-2"><Sourced field={c.phone} /></td>
                      <td className="px-3 py-2"><Sourced field={c.linkedin} /></td>
                      <td className="px-3 py-2">{c.address ? <Sourced field={c.address} /> : <span className="text-xs text-muted-foreground">{c.inputLocation}</span>}</td>
                      <td className="px-3 py-2">
                        {c.status === "collecting"
                          ? <span className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--risky))]"><Loader2 className="size-3 animate-spin" /> Collecting</span>
                          : <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", st.className)}>{st.label}</span>}
                      </td>
                      <td className="px-2 py-2 text-right"><ChevronRight className="size-4 text-muted-foreground" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
          <span>{formatNumber(total)} companies</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
            <span className="tabular-nums">Page {page} / {totalPages}</span>
            <Button size="sm" variant="outline" className="h-8" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
          </div>
        </div>
      )}

      {/* Floating selection bar — same treatment as the Jobs tab. */}
      {someSelected && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-xl border bg-card/95 p-2 pl-4 shadow-2xl backdrop-blur">
            <span className="flex items-center gap-2 pr-1 text-sm font-semibold">
              <span className="rounded-md bg-primary px-2 py-0.5 text-primary-foreground tabular-nums">{formatNumber(effectiveCount)}</span> selected
            </span>
            {!allMatching && total > selectedIds.size && (
              <button onClick={selectAll} className="text-xs font-medium text-primary hover:underline">Select all {formatNumber(total)}</button>
            )}
            <div className="h-6 w-px bg-border" />
            <Button size="sm" onClick={findPeople} disabled={findingPeople}>{findingPeople ? <Loader2 className="size-4 animate-spin" /> : <Users className="size-4" />} Find people</Button>
            <DropdownMenu up align="end" trigger={<Button size="sm" variant="ghost" disabled={busy !== null}>{busy === "list" ? <Loader2 className="size-4 animate-spin" /> : <ListPlus className="size-4" />} Add to list <ChevronDown className="size-3.5" /></Button>}>
              {lists.length > 0 && lists.map((l) => (
                <DropdownItem key={l.id} onClick={() => addSelectedToList(l.id, l.name)}><ListPlus /> {l.name} <span className="ml-auto text-xs text-muted-foreground">{l.summary.total}</span></DropdownItem>
              ))}
              {lists.length > 0 && <DropdownSeparator />}
              <DropdownItem onClick={() => { setNewListName(""); setNewListOpen(true); }}><Plus /> New list</DropdownItem>
            </DropdownMenu>
            <Button size="sm" variant="outline" onClick={onExport} disabled={busy !== null}>{busy === "export" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Export</Button>
            <button onClick={clearSelection} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Clear selection"><X className="size-4" /></button>
          </div>
        </div>
      )}

      {/* New list dialog — name it (same as the /lists screen), then add the selection. */}
      <Dialog open={newListOpen} onOpenChange={(o) => { if (!o) { setNewListOpen(false); setNewListName(""); } }}>
        <DialogHeader>
          <DialogTitle>New list</DialogTitle>
          <DialogDescription>Name the list, then add the {formatNumber(effectiveCount)} selected {effectiveCount === 1 ? "company" : "companies"}.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={newListName}
          onChange={(e) => setNewListName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newListName.trim()) createAndAdd(); }}
          placeholder="List name"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => { setNewListOpen(false); setNewListName(""); }}>Cancel</Button>
          <Button disabled={!newListName.trim() || busy === "list"} onClick={createAndAdd}>{busy === "list" ? <Loader2 className="size-4 animate-spin" /> : null} Create &amp; add</Button>
        </DialogFooter>
      </Dialog>
      </div>
    </div>
  );
}

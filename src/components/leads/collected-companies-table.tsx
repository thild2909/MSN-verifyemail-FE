"use client";
import { ColHead } from "@/components/common/col-head";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Inbox, Loader2, ChevronRight, Database, Linkedin, ChevronDown, ListPlus, Download, Users, X, Plus, SlidersHorizontal, CheckCircle2, Clock, SearchX, XCircle } from "lucide-react";
import { IconTile, Field, Pill, type Tone } from "@/components/common/kit";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox as Check } from "@/components/ui/checkbox";
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
import { EMPTY_COMPANY_FILTERS, countCompanyFilters, type CompanyFilters, type CollectedCompany, type CollectStatus } from "@/lib/leads/collect-types";

const PAGE_SIZE = 25;

/** Empty-cell placeholder, same as the People table. */
const DASH = <span className="text-muted-foreground/60">—</span>;
const linkedinHref = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://${v}`);

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

/** Status chip: kit Pill toned by meaning, label from the shared meta. */
const STATUS_PILL: Record<CollectStatus, { tone: Tone; icon: React.ElementType }> = {
  pending: { tone: "muted", icon: Clock },
  collecting: { tone: "risky", icon: Loader2 },
  enriched: { tone: "valid", icon: CheckCircle2 },
  not_found: { tone: "muted", icon: SearchX },
  failed: { tone: "invalid", icon: XCircle },
};
function StatusPill({ status }: { status: CollectStatus }) {
  const meta = COLLECT_STATUS_META[status] ?? COLLECT_STATUS_META.enriched;
  const p = STATUS_PILL[status] ?? STATUS_PILL.enriched;
  const Icon = p.icon;
  return (
    <Pill tone={p.tone} className="shrink-0 whitespace-nowrap normal-case">
      <Icon className={cn("size-3", status === "collecting" && "animate-spin")} strokeWidth={2} />
      {meta.label}
    </Pill>
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
        <aside className="hidden w-64 shrink-0 flex-col overflow-clip border-r border-border bg-card md:flex">
          <CompanyFilterPanel filters={filters} facets={facets} onChange={setFilters} onClear={() => setFilters(EMPTY_COMPANY_FILTERS)} />
        </aside>
      )}
      <MobileFilterDrawer open={mobileFilters} onClose={() => setMobileFilters(false)}>
        <CompanyFilterPanel filters={filters} facets={facets} onChange={setFilters} onClear={() => setFilters(EMPTY_COMPANY_FILTERS)} />
      </MobileFilterDrawer>
      <div className="relative flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2.5 sm:px-6">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company or location…" type="search" autoComplete="off" data-1p-ignore data-lpignore="true" className="h-9 pl-9" />
        </div>
        <span className="hidden shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs text-muted-foreground sm:inline-flex">{live && <span className="size-1.5 rounded-full bg-brand animate-pulse" />}<span className="font-semibold text-foreground tabular-nums">{formatNumber(total)}</span> companies</span>
        <Button size="sm" variant={showFilters ? "brand" : "outline"} className="h-9 shrink-0 sm:ml-auto" onClick={() => openFiltersFor(setShowFilters, setMobileFilters)}>
          <SlidersHorizontal /> <span className="hidden sm:inline">Filters</span>{filtersActive > 0 && <span className="ml-0.5 rounded-md bg-brand/10 px-1.5 py-px text-[10px] font-semibold tabular-nums text-brand sm:ml-1">{filtersActive}</span>}
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2 p-4 sm:px-6">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
        ) : total === 0 ? (
          <EmptyState icon={Inbox} title="No companies match" description="Try clearing the search or filter." className="m-6" />
        ) : (
          <>
          {/* Mobile: company cards */}
          <div className={cn("scrollbar-thin h-full space-y-2 overflow-auto bg-background p-3 transition-opacity md:hidden", isPlaceholderData && "opacity-60")}>
            {rows.map((c) => {
              const selected = rowChecked(c.id);
              return (
                <div key={c.id} onClick={() => onOpenCompany(c)} className={cn("rounded-xl border border-border bg-card p-3 shadow-xs transition-colors active:bg-accent", selected && "border-brand/40 bg-brand/[0.05]")}>
                  <div className="flex items-start gap-2.5">
                    <div className="pt-0.5" onClick={(e) => e.stopPropagation()}><Check checked={selected} onChange={() => toggleRow(c.id)} /></div>
                    <CompanyLogo domain={c.domainGuess} text={c.logoText || c.inputName.slice(0, 2).toUpperCase()} className="size-8 shrink-0 rounded-lg text-[11px]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold leading-snug">{c.inputName}</p>
                      <p className="truncate text-xs text-muted-foreground">{c.inputLocation}{c.domainGuess ? ` · ${c.domainGuess}` : ""}</p>
                    </div>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-[26px]">
                    <StatusPill status={c.status} />
                    {c.llmVerification && <LlmBadge v={c.llmVerification} />}
                  </div>
                  <div className="mt-2.5 space-y-2 border-t border-border pl-[26px] pt-2.5 text-xs">
                    {(c.contactEmail?.value != null || c.emailVerification) && (
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">{c.contactEmail ? <span className="break-all font-medium"><Sourced field={c.contactEmail} /></span> : DASH}{c.emailVerification && <VerificationBadge ev={c.emailVerification} />}</div>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                      {c.employees?.value != null && <span>Emp <Sourced field={c.employees} /></span>}
                      {c.industry?.value != null && <span className="min-w-0"><Sourced field={c.industry} /></span>}
                      {c.website?.value != null && <span className="min-w-0"><Sourced field={c.website} /></span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop: table */}
          <div className={cn("scrollbar-thin hidden h-full overflow-auto bg-card transition-opacity md:block", isPlaceholderData && "opacity-60")}>
            <table className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
                <tr className="border-b border-border text-left text-[13px] font-normal text-muted-foreground">
                  <th className="w-10 py-3 pl-4 pr-2 sm:pl-6">
                    <div className="flex items-center gap-1">
                      <Check checked={allMatching || allPageSelected} indeterminate={someSelected && !allMatching && !allPageSelected} onChange={toggleHeader} />
                      <DropdownMenu align="start" trigger={<button className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground" aria-label="Selection options"><ChevronDown className="size-3.5" /></button>}>
                        <DropdownItem onClick={selectThisPage}>Select this page ({pageIds.length})</DropdownItem>
                        <DropdownItem onClick={selectAll}>Select all {formatNumber(total)}</DropdownItem>
                        {someSelected && <><DropdownSeparator /><DropdownItem onClick={clearSelection}>Clear selection</DropdownItem></>}
                      </DropdownMenu>
                    </div>
                  </th>
                  <th className="whitespace-nowrap px-3 py-3"><ColHead label="Company" /></th>
                  <th className="whitespace-nowrap px-3 py-3 text-center"><ColHead label="Employees" align="center" /></th>
                  <th className="whitespace-nowrap px-3 py-3"><ColHead label="Industry" /></th>
                  <th className="whitespace-nowrap px-3 py-3"><ColHead label="Website" /></th>
                  <th className="whitespace-nowrap px-3 py-3"><ColHead label="Email" /></th>
                  <th className="whitespace-nowrap px-3 py-3"><ColHead label="Phone" /></th>
                  <th className="whitespace-nowrap px-3 py-3"><ColHead label="LinkedIn" /></th>
                  <th className="whitespace-nowrap px-3 py-3"><ColHead label="Location" /></th>
                  <th className="whitespace-nowrap px-3 py-3"><ColHead label="Status" /></th>
                  <th className="w-8 pr-4 sm:pr-6" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const emailField = c.contactEmail;
                  const selected = rowChecked(c.id);
                  return (
                    <tr key={c.id} onClick={() => onOpenCompany(c)} className={cn("group cursor-pointer border-b border-border transition-colors hover:bg-surface/60", selected && "bg-brand/[0.05] hover:bg-brand/[0.07]")}>
                      <td className="py-2.5 pl-4 pr-2 align-top sm:pl-6" onClick={(e) => e.stopPropagation()}>
                        <div className="pt-1.5"><Check checked={selected} onChange={() => toggleRow(c.id)} /></div>
                      </td>
                      <td className="min-w-[200px] max-w-[300px] px-3 py-2.5 align-top">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <CompanyLogo domain={c.domainGuess} text={c.logoText || c.inputName.slice(0, 2).toUpperCase()} className="size-8 rounded-lg text-[11px]" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate pt-0.5 font-semibold leading-snug text-foreground transition-colors group-hover:text-brand">{c.inputName}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {c.inputLocation}{c.domainGuess ? ` · ${c.domainGuess}` : ""}
                              {c.resolution && c.resolution.confidence > 0 ? ` · ${c.resolution.confidence}% match` : ""}
                            </p>
                            {(c.resolution?.cacheHit || c.llmVerification) && (
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {c.resolution?.cacheHit && <Database className="size-3 shrink-0 text-muted-foreground" aria-label="Served from cache" />}
                                {c.llmVerification && <LlmBadge v={c.llmVerification} />}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-center align-top tabular-nums text-muted-foreground">{c.employees ? <Sourced field={c.employees} showConfidence /> : DASH}</td>
                      <td className="min-w-[140px] max-w-[240px] px-3 py-2.5 align-top text-muted-foreground">{c.industry ? <span className="whitespace-normal break-words"><Sourced field={c.industry} /></span> : DASH}</td>
                      <td className="max-w-[220px] px-3 py-2.5 align-top text-muted-foreground">{c.website ? <span className="line-clamp-1"><Sourced field={c.website} /></span> : DASH}</td>
                      <td className="min-w-[220px] max-w-[360px] px-3 py-2.5 align-top">
                        {emailField || c.emailVerification ? (
                          <div className="flex flex-col items-start gap-1">
                            {emailField ? <span className="break-all text-xs font-medium text-foreground"><Sourced field={emailField} /></span> : DASH}
                            {c.emailVerification && <VerificationBadge ev={c.emailVerification} />}
                          </div>
                        ) : DASH}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 align-top tabular-nums text-muted-foreground">{c.phone ? <Sourced field={c.phone} /> : DASH}</td>
                      <td className="px-3 py-2.5 align-top" onClick={(e) => e.stopPropagation()}>
                        {c.linkedin?.value ? (
                          <a href={linkedinHref(String(c.linkedin.value))} target="_blank" rel="noreferrer" className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-brand/10 hover:text-brand" aria-label="View LinkedIn"><Linkedin className="size-4" strokeWidth={1.75} /></a>
                        ) : DASH}
                      </td>
                      <td className="min-w-[140px] max-w-[260px] px-3 py-2.5 align-top text-muted-foreground">
                        {c.address ? <span className="whitespace-normal break-words"><Sourced field={c.address} /></span> : c.inputLocation ? <span className="whitespace-normal break-words">{c.inputLocation}</span> : DASH}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        {c.status === "collecting"
                          ? <StatusPill status="collecting" />
                          : <StatusPill status={c.status} />}
                      </td>
                      <td className="py-2.5 pl-2 pr-4 text-right align-top sm:pr-6"><ChevronRight className="mt-1 size-4 text-muted-foreground/60 transition-colors group-hover:text-brand" strokeWidth={1.75} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between gap-2 border-t border-border bg-card px-4 py-2.5 text-xs text-muted-foreground sm:px-6">
          <span><span className="font-semibold tabular-nums text-foreground">{formatNumber(total)}</span> companies</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
            <span className="rounded-md bg-surface px-2 py-1 font-medium tabular-nums text-foreground">Page {page} / {totalPages}</span>
            <Button size="sm" variant="outline" className="h-8" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
          </div>
        </div>
      )}

      {/* Floating selection bar — same treatment as the Jobs tab. */}
      {someSelected && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-card/95 p-2 pl-3 shadow-pop backdrop-blur">
            <span className="flex items-center gap-2 pr-1 text-sm font-semibold">
              <span className="rounded-md bg-brand/10 px-2 py-0.5 text-brand tabular-nums">{formatNumber(effectiveCount)}</span> selected
            </span>
            {!allMatching && total > selectedIds.size && (
              <button onClick={selectAll} className="text-xs font-medium text-brand hover:underline">Select all {formatNumber(total)}</button>
            )}
            <div className="h-6 w-px bg-border" />
            <Button size="sm" onClick={findPeople} disabled={findingPeople}>{findingPeople ? <Loader2 className="animate-spin" /> : <Users />} Find people</Button>
            <DropdownMenu up align="end" trigger={<Button size="sm" variant="outline" disabled={busy !== null}>{busy === "list" ? <Loader2 className="animate-spin" /> : <ListPlus />} Add to list <ChevronDown className="opacity-60" /></Button>}>
              {lists.length > 0 && lists.map((l) => (
                <DropdownItem key={l.id} onClick={() => addSelectedToList(l.id, l.name)}><ListPlus /> {l.name} <span className="ml-auto text-xs tabular-nums text-muted-foreground">{l.summary.total}</span></DropdownItem>
              ))}
              {lists.length > 0 && <DropdownSeparator />}
              <DropdownItem onClick={() => { setNewListName(""); setNewListOpen(true); }}><Plus /> New list</DropdownItem>
            </DropdownMenu>
            <Button size="sm" variant="outline" onClick={onExport} disabled={busy !== null}>{busy === "export" ? <Loader2 className="animate-spin" /> : <Download />} Export</Button>
            <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" onClick={clearSelection} aria-label="Clear selection"><X /></Button>
          </div>
        </div>
      )}

      {/* New list dialog — name it (same as the /lists screen), then add the selection. */}
      <Dialog open={newListOpen} onOpenChange={(o) => { if (!o) { setNewListOpen(false); setNewListName(""); } }}>
        <DialogHeader>
          <IconTile icon={ListPlus} tone="brand" className="mb-3" />
          <DialogTitle>New list</DialogTitle>
          <DialogDescription>Name the list, then add the {formatNumber(effectiveCount)} selected {effectiveCount === 1 ? "company" : "companies"}.</DialogDescription>
        </DialogHeader>
        <Field label="List name" htmlFor="new-company-list-name">
          <Input
            id="new-company-list-name"
            autoFocus
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newListName.trim()) createAndAdd(); }}
            placeholder="List name"
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setNewListOpen(false); setNewListName(""); }}>Cancel</Button>
          <Button disabled={!newListName.trim() || busy === "list"} onClick={createAndAdd}>{busy === "list" ? <Loader2 className="animate-spin" /> : null} Create &amp; add</Button>
        </DialogFooter>
      </Dialog>
      </div>
    </div>
  );
}

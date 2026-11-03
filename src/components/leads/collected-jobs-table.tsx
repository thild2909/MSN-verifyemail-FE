"use client";
import { ColHead } from "@/components/common/col-head";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Briefcase, Search, SlidersHorizontal, ChevronDown, Users, Download, X, Loader2, ListPlus, Plus } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox as Check } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { getCrawledJobs, getLeadLists, createLeadList, addLeadItems, type CrawledJobsQuery } from "@/lib/api/client";
import { jobsToCompanyLeadItems, addToListToast } from "@/lib/leads/lead-snapshot";
import { toCsv, downloadCsv } from "@/lib/leads/csv";
import { JOB_SOURCE_LABEL, type CollectedJob, type JobSource } from "@/lib/leads/job-collect-types";
import type { PeopleSeedInput } from "@/lib/leads/people-types";
import type { JobFilters } from "@/lib/leads/types";
import { Pill, IconTile, type Tone } from "@/components/common/kit";
import { CompanyLogo } from "./collect-ui";
import { JobFilterSidebar } from "./job-filter-sidebar";
import { MobileFilterDrawer, openFiltersFor } from "./filter-drawer";

const PAGE_SIZE = 25;

/** Payload handed up when the user clicks "Find people" — deduped employer
 *  seeds plus the distinct-employer count for the toast. */
export interface FindPeopleFromJobsPayload {
  seeds: PeopleSeedInput[];
  count: number;
}

/** Per-source tone so the Source column is scannable at a glance. */
const SOURCE_TONE: Record<JobSource, Tone> = {
  seek: "sky",
  indeed: "brand",
  reed: "invalid",
  dice: "risky",
  ctgoodjobs: "invalid",
  foundit: "risky",
  glassdoor: "valid",
  mycareersfuture: "sky",
  wellfound: "violet",
};

export function SourceBadge({ source }: { source: JobSource }) {
  return (
    <Pill tone={SOURCE_TONE[source] ?? "muted"} dot className="normal-case">
      {JOB_SOURCE_LABEL[source] ?? source}
    </Pill>
  );
}

/** Leading tile for a role row: same shape/tint as a company-logo fallback. */
function JobTile() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-inset ring-brand/15">
      <Briefcase className="size-4" strokeWidth={1.75} />
    </span>
  );
}

/** Secondary chip (work mode / employment type), like the People table alt-name chip. */
const CHIP = "inline-flex shrink-0 items-center rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground";
/** Empty-cell placeholder, same as the People table. */
const DASH = <span className="text-muted-foreground/60">—</span>;

/** Small square checkbox matching the People / Companies tables. */
function postedLabel(j: CollectedJob): string {
  if (j.posted) return j.posted;
  if (j.postedDaysAgo == null) return "—";
  if (j.postedDaysAgo <= 0) return "Today";
  if (j.postedDaysAgo === 1) return "Yesterday";
  if (j.postedDaysAgo < 7) return `${j.postedDaysAgo}d ago`;
  if (j.postedDaysAgo < 30) return `${Math.round(j.postedDaysAgo / 7)}w ago`;
  return "30+ days ago";
}

/** Dedupe the selected roles down to one seed per distinct employer (case-
 *  insensitive), carrying the first location we see for that company. Empty
 *  company names are dropped — they can't seed a people crawl. */
function seedsFromJobs(jobs: CollectedJob[]): PeopleSeedInput[] {
  const byCompany = new Map<string, PeopleSeedInput>();
  for (const j of jobs) {
    const company = j.company?.trim();
    if (!company) continue;
    const key = company.toLowerCase();
    if (byCompany.has(key)) continue;
    byCompany.set(key, { company, location: j.location ?? j.country ?? "" });
  }
  return [...byCompany.values()];
}

/**
 * Roles table. Mirrors the People/Companies tables: a toggleable left filter
 * sidebar (inline on md+, a drawer on mobile), a toolbar with a search box +
 * count + Filters button, and bottom pagination. The filter state is owned by
 * the parent Jobs tab (it also seeds the crawl), so it's passed in and this
 * component drives the sidebar through the same handlers.
 *
 * Rows are selectable (per-row checkbox + header select-all) — the same
 * treatment as the Companies tab — feeding a floating bulk bar whose primary
 * action is "Find people": seed a people crawl from the selected employers.
 */
export function CollectedJobsTable({
  jobId,
  live,
  query,
  filters,
  onChangeFilters,
  onClearFilters,
  activeFilterCount,
  onFindPeople,
  findingPeople,
}: {
  jobId: string;
  live: boolean;
  query: Omit<CrawledJobsQuery, "page" | "pageSize" | "search">;
  filters: JobFilters;
  onChangeFilters: (patch: Partial<JobFilters>) => void;
  onClearFilters: () => void;
  activeFilterCount: number;
  onFindPeople?: (payload: FindPeopleFromJobsPayload) => void;
  findingPeople?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: lists = [] } = useQuery({ queryKey: ["lead-lists"], queryFn: getLeadLists });
  const [newListOpen, setNewListOpen] = React.useState(false);
  const [newListName, setNewListName] = React.useState("");
  const [showFilters, setShowFilters] = React.useState(true);
  const [mobileFilters, setMobileFilters] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);

  const queryKeyStr = JSON.stringify(query);
  const effQuery = React.useMemo(() => ({ ...query, search: debounced }), [queryKeyStr, debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { setPage(1); }, [jobId, debounced, queryKeyStr]);

  // Selection: explicit ids, or "all matching the current query".
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = React.useState(false);
  React.useEffect(() => { setSelectedIds(new Set()); setAllMatching(false); }, [jobId, debounced, queryKeyStr]);

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["crawled-jobs", jobId, effQuery, page],
    queryFn: () => getCrawledJobs(jobId, { ...effQuery, page, pageSize: PAGE_SIZE }),
    refetchInterval: live ? 2000 : false,
    placeholderData: (prev) => prev,
  });

  const rows = data?.jobs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageIds = rows.map((r) => r.id);

  const effectiveCount = allMatching ? total : selectedIds.size;
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => allMatching || selectedIds.has(id));
  const someSelected = effectiveCount > 0;

  const rowChecked = (id: string) => allMatching || selectedIds.has(id);
  const toggleRow = (id: string) => {
    if (allMatching) {
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

  /** Resolve the full CollectedJob rows behind the current selection. */
  const resolveSelected = React.useCallback(async (): Promise<CollectedJob[]> => {
    const all = await getCrawledJobs(jobId, { ...query, search: debounced, page: 1, pageSize: 100000 });
    return allMatching ? all.jobs : all.jobs.filter((j) => selectedIds.has(j.id));
  }, [jobId, queryKeyStr, debounced, allMatching, selectedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const [busy, setBusy] = React.useState<null | "export" | "people" | "list">(null);

  /** One company lead item per distinct employer behind the current selection. */
  const companyItems = async () => jobsToCompanyLeadItems(
    (await resolveSelected()).map((j) => ({ name: j.company, location: j.location, logoText: j.companyLogoText })),
    jobId,
  );

  const addSelectedToList = async (listId: string, listName: string) => {
    setBusy("list");
    try {
      const items = await companyItems();
      if (items.length === 0) { toast({ variant: "info", title: "No employers to add", description: "The selected roles have no company name." }); return; }
      const { added, skipped } = await addLeadItems(listId, items);
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
      toast(addToListToast(added, skipped, listName));
    } catch { toast({ variant: "error", title: "Could not add to list" }); }
    finally { setBusy(null); }
  };

  const createAndAdd = async () => {
    const name = newListName.trim();
    if (!name) return;
    setBusy("list");
    try {
      const items = await companyItems();
      if (items.length === 0) { toast({ variant: "info", title: "No employers to add" }); setNewListOpen(false); return; }
      const list = await createLeadList(name);
      const { added, skipped } = await addLeadItems(list.id, items);
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
      setNewListOpen(false); setNewListName("");
      toast(addToListToast(added, skipped, list.name));
    } catch { toast({ variant: "error", title: "Could not create list" }); }
    finally { setBusy(null); }
  };

  const onExport = async () => {
    setBusy("export");
    try {
      const sel = await resolveSelected();
      const headers = ["Company", "Location", "Posted"];
      const csv = toCsv(headers, sel.map((j) => [
        j.company, j.location ?? "", postedLabel(j),
      ]));
      downloadCsv(`jobs-${jobId}`, csv);
      toast({ variant: "success", title: `Exported ${formatNumber(sel.length)} roles` });
    } catch { toast({ variant: "error", title: "Export failed" }); }
    finally { setBusy(null); }
  };

  const findPeople = async () => {
    if (!onFindPeople) return;
    setBusy("people");
    try {
      const sel = await resolveSelected();
      const seeds = seedsFromJobs(sel);
      if (seeds.length === 0) { toast({ variant: "error", title: "No employers to search", description: "The selected roles have no company name." }); return; }
      onFindPeople({ seeds, count: seeds.length });
    } catch { toast({ variant: "error", title: "Couldn't start", description: "Try again." }); }
    finally { setBusy(null); }
  };

  return (
    <div className="flex min-h-0 flex-1">
      {showFilters && (
        <aside className="hidden w-64 shrink-0 flex-col overflow-clip border-r border-border bg-card md:flex">
          <JobFilterSidebar filters={filters} onChange={onChangeFilters} activeCount={activeFilterCount} onClear={onClearFilters} />
        </aside>
      )}
      <MobileFilterDrawer open={mobileFilters} onClose={() => setMobileFilters(false)}>
        <JobFilterSidebar filters={filters} onChange={onChangeFilters} activeCount={activeFilterCount} onClear={onClearFilters} />
      </MobileFilterDrawer>

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2.5 sm:px-6">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search role, company or location…" type="search" autoComplete="off" data-1p-ignore data-lpignore="true" className="h-9 pl-9" />
          </div>
          <span className="hidden items-center gap-1.5 whitespace-nowrap text-[13px] text-muted-foreground sm:inline-flex">
            {live && <span className="size-1.5 rounded-full bg-brand animate-pulse" aria-hidden />}
            <span className="font-semibold text-foreground tabular-nums">{formatNumber(total)}</span> roles
          </span>
          <Button
            size="sm"
            variant="outline"
            className={cn("h-9 shrink-0 sm:ml-auto", showFilters && "md:border-brand/35 md:bg-brand/5 md:text-brand md:hover:bg-brand/10")}
            onClick={() => openFiltersFor(setShowFilters, setMobileFilters)}
          >
            <SlidersHorizontal /> <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && <span className="rounded-md bg-brand/10 px-1.5 py-px text-[10px] font-semibold leading-4 text-brand tabular-nums">{activeFilterCount}</span>}
          </Button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1">
          {isLoading && !data ? (
            <div className="space-y-2 p-4 sm:px-6">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
          ) : total === 0 ? (
            <EmptyState
              icon={Briefcase}
              title={live ? "Crawling job boards…" : "No roles found"}
              description={live ? "Roles will appear here as each source returns." : "The sources returned no matching roles, or were blocked. Try clearing the filter."}
              className="m-4 sm:m-6"
            />
          ) : (
            <>
            <div className={cn("scrollbar-thin h-full space-y-2 overflow-auto bg-background p-3 transition-opacity md:hidden", isPlaceholderData && "opacity-60")}>
              {rows.map((j) => {
                const selected = rowChecked(j.id);
                return (
                  <div key={j.id} className={cn("rounded-xl border border-border bg-card p-3 shadow-xs transition-colors", selected && "border-brand/40 bg-brand/[0.05]")}>
                    <div className="flex items-start gap-2.5">
                      <div className="pt-0.5" onClick={(e) => e.stopPropagation()}><Check checked={selected} onChange={() => toggleRow(j.id)} /></div>
                      <JobTile />
                      <div className="min-w-0 flex-1">
                        <a href={j.url || undefined} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm font-semibold leading-snug text-foreground transition-colors hover:text-brand">{j.title}</a>
                        {j.location && <p className="truncate text-xs text-muted-foreground">{j.location}</p>}
                      </div>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-[26px]">
                      <SourceBadge source={j.source} />
                      {j.workMode && <span className={CHIP}>{j.workMode}</span>}
                      {j.employmentType && <span className={CHIP}>{j.employmentType}</span>}
                    </div>
                    <div className="mt-2.5 space-y-2 border-t border-border pl-[26px] pt-2.5 text-xs">
                      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <CompanyLogo text={j.companyLogoText} className="size-5 shrink-0 text-[9px]" />
                        <span className="min-w-0 truncate font-medium text-foreground">{j.company}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                        {j.salary && <span className="tabular-nums">{j.salary}</span>}
                        <span className="tabular-nums">{postedLabel(j)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

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
                    <th className="px-3 py-3"><ColHead label="Job" /></th>
                    <th className="px-3 py-3"><ColHead label="Company" /></th>
                    <th className="px-3 py-3"><ColHead label="Location" /></th>
                    <th className="px-3 py-3"><ColHead label="Source" /></th>
                    <th className="px-3 py-3"><ColHead label="Salary" /></th>
                    <th className="px-3 py-3"><ColHead label="Posted" /></th>
                    <th className="w-10 pr-4 sm:pr-6" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((j) => {
                    const selected = rowChecked(j.id);
                    return (
                      <tr key={j.id} className={cn("group border-b border-border transition-colors hover:bg-surface/60", selected && "bg-brand/[0.05] hover:bg-brand/[0.07]")}>
                        <td className="py-2.5 pl-4 pr-2 align-top sm:pl-6" onClick={(e) => e.stopPropagation()}>
                          <div className="pt-1.5"><Check checked={selected} onChange={() => toggleRow(j.id)} /></div>
                        </td>
                        <td className="min-w-[220px] max-w-[360px] px-3 py-2.5 align-top">
                          <div className="flex min-w-0 items-start gap-2.5">
                            <JobTile />
                            <div className="min-w-0 flex-1">
                              <a href={j.url || undefined} target="_blank" rel="noreferrer" title={j.title} className="block truncate pt-0.5 font-semibold leading-snug text-foreground transition-colors group-hover:text-brand">{j.title}</a>
                              {(j.workMode || j.employmentType) && (
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  {j.workMode && <span className={CHIP}>{j.workMode}</span>}
                                  {j.employmentType && <span className={CHIP}>{j.employmentType}</span>}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="min-w-[180px] max-w-[320px] px-3 py-2.5 align-top">
                          <div className="flex min-w-0 items-start gap-2">
                            <CompanyLogo text={j.companyLogoText} className="mt-0.5 size-6 text-[10px]" />
                            <span className="whitespace-normal break-words pt-0.5 font-medium text-foreground">{j.company}</span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 align-top text-muted-foreground">{j.location || DASH}</td>
                        <td className="px-3 py-2.5 align-top"><SourceBadge source={j.source} /></td>
                        <td className="whitespace-nowrap px-3 py-2.5 align-top tabular-nums text-muted-foreground">{j.salary ?? DASH}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 align-top tabular-nums text-muted-foreground">{j.posted || j.postedDaysAgo != null ? postedLabel(j) : DASH}</td>
                        <td className="py-2.5 pl-2 pr-4 text-right align-top sm:pr-6">
                          {j.url && (
                            <a href={j.url} target="_blank" rel="noreferrer" className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-brand/10 hover:text-brand group-hover:text-brand" aria-label="Open role">
                              <ExternalLink className="size-4" strokeWidth={1.75} />
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between border-t border-border bg-card px-4 py-2.5 text-[13px] text-muted-foreground sm:px-6">
            <span><span className="font-medium tabular-nums text-foreground">{formatNumber(total)}</span> roles</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
              <span className="tabular-nums">Page <span className="font-medium text-foreground">{page}</span> / {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
            </div>
          </div>
        )}

        {/* Floating selection bar — same treatment as the Companies tab. */}
        {someSelected && (
          <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
            <div className="pointer-events-auto flex max-w-full animate-fade-in flex-wrap items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-1.5 pl-3 shadow-pop">
              <span className="flex items-center gap-2 pr-1 text-[13px] font-medium">
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums">{formatNumber(effectiveCount)}</span> selected
              </span>
              {!allMatching && total > selectedIds.size && (
                <button onClick={selectAll} className="rounded-md px-1.5 py-0.5 text-xs font-medium text-brand transition-colors hover:bg-brand/10">Select all {formatNumber(total)}</button>
              )}
              <div className="mx-0.5 h-5 w-px bg-border" />
              {onFindPeople && (
                <Button size="sm" onClick={findPeople} disabled={findingPeople || busy !== null}>{findingPeople || busy === "people" ? <Loader2 className="animate-spin" /> : <Users />} Find people</Button>
              )}
              <DropdownMenu up align="end" trigger={<Button size="sm" variant="outline" disabled={busy !== null}>{busy === "list" ? <Loader2 className="animate-spin" /> : <ListPlus />} Add to list <ChevronDown className="size-3.5" /></Button>}>
                {lists.map((l) => (
                  <DropdownItem key={l.id} onClick={() => addSelectedToList(l.id, l.name)}><ListPlus /> {l.name} <span className="ml-auto text-xs tabular-nums text-muted-foreground">{l.summary.total}</span></DropdownItem>
                ))}
                {lists.length > 0 && <DropdownSeparator />}
                <DropdownItem onClick={() => { setNewListName(""); setNewListOpen(true); }}><Plus /> New list</DropdownItem>
              </DropdownMenu>
              <Button size="sm" variant="outline" onClick={onExport} disabled={busy !== null}>{busy === "export" ? <Loader2 className="animate-spin" /> : <Download />} Export</Button>
              <button onClick={clearSelection} className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface hover:text-foreground" aria-label="Clear selection"><X className="size-4" /></button>
            </div>
          </div>
        )}

        {/* New list dialog — name it, then add the selected employers as companies. */}
        <Dialog open={newListOpen} onOpenChange={(o) => { if (!o) { setNewListOpen(false); setNewListName(""); } }}>
          <DialogHeader>
            <IconTile icon={ListPlus} tone="brand" className="mb-3" />
            <DialogTitle>New list</DialogTitle>
            <DialogDescription>Name the list, then add the employers from the {formatNumber(effectiveCount)} selected {effectiveCount === 1 ? "role" : "roles"} as companies.</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={newListName} onChange={(e) => setNewListName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newListName.trim()) createAndAdd(); }} placeholder="List name" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewListOpen(false)}>Cancel</Button>
            <Button disabled={!newListName.trim() || busy === "list"} onClick={createAndAdd}>{busy === "list" ? <Loader2 className="animate-spin" /> : null} Create &amp; add</Button>
          </DialogFooter>
        </Dialog>
      </div>
    </div>
  );
}

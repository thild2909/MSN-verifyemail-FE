"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, MapPin, Briefcase, Search, SlidersHorizontal, ChevronDown, Users, Download, X, Loader2, CheckCircle2, Building2, ListPlus, Plus } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox as Check } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { getCollectedLinkedInJobs, getLeadLists, createLeadList, addLeadItems, type CollectedLinkedInJobsQuery, type CollectedLinkedInJobsPage } from "@/lib/api/client";
import { jobsToCompanyLeadItems, addToListToast } from "@/lib/leads/lead-snapshot";
import { toCsv, downloadCsv } from "@/lib/leads/csv";
import type { CollectedLinkedInJob, LinkedInJobFilters } from "@/lib/leads/linkedin-jobs-types";
import type { PeopleSeedInput } from "@/lib/leads/people-types";
import { CompanyLogo, ScoreBar } from "./leads-ui";
import { LinkedInJobsFilterSidebar } from "./linkedin-jobs-filter-sidebar";
import { MobileFilterDrawer, openFiltersFor } from "./filter-drawer";

const PAGE_SIZE = 25;

export interface FindPeopleFromLinkedInPayload {
  seeds: PeopleSeedInput[];
  count: number;
}


function postedLabel(j: CollectedLinkedInJob): string {
  if (j.postedDaysAgo == null) return j.postedText ?? "—";
  if (j.postedDaysAgo <= 0) return "Today";
  if (j.postedDaysAgo === 1) return "Yesterday";
  if (j.postedDaysAgo < 7) return `${j.postedDaysAgo}d ago`;
  if (j.postedDaysAgo < 30) return `${Math.round(j.postedDaysAgo / 7)}w ago`;
  return "30+ days ago";
}

/** Dedupe selected roles to one seed per distinct employer. */
function seedsFromJobs(jobs: CollectedLinkedInJob[]): PeopleSeedInput[] {
  const byCompany = new Map<string, PeopleSeedInput>();
  for (const j of jobs) {
    const company = j.company?.trim();
    if (!company || company === "—") continue;
    const key = company.toLowerCase();
    if (byCompany.has(key)) continue;
    byCompany.set(key, { company, location: j.city ?? j.country ?? j.location ?? "", domain: j.companyWebsite ?? null });
  }
  return [...byCompany.values()];
}

function countActive(f: LinkedInJobFilters): number {
  let n = f.roleFamilies.length + f.countries.length + f.seniorities.length;
  if (f.remoteOnly) n++;
  if (!f.qualifiedOnly) n++; // qualified-only is the default; showing all is an active choice
  if (f.minScore > 0) n++;
  if (f.postedWithinDays > 0) n++;
  return n;
}

/**
 * LinkedIn roles table. Mirrors the Jobs table (filter sidebar, search toolbar,
 * pagination, row selection → floating bulk bar). Extra columns surface the
 * pipeline output: role family, fit score, company industry/size, and a
 * "Qualified" marker. Bulk actions: Find people (seed a people crawl from the
 * selected employers) + Export.
 */
export function CollectedLinkedInJobsTable({
  jobId, live, filters, onChangeFilters, onClearFilters, onFindPeople, findingPeople,
}: {
  jobId: string;
  live: boolean;
  filters: LinkedInJobFilters;
  onChangeFilters: (patch: Partial<LinkedInJobFilters>) => void;
  onClearFilters: () => void;
  onFindPeople?: (payload: FindPeopleFromLinkedInPayload) => void;
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

  const query: Omit<CollectedLinkedInJobsQuery, "page" | "pageSize" | "search"> = React.useMemo(() => ({
    roleFamilies: filters.roleFamilies,
    countries: filters.countries,
    seniorities: filters.seniorities,
    remoteOnly: filters.remoteOnly,
    qualifiedOnly: filters.qualifiedOnly,
    minScore: filters.minScore > 0 ? filters.minScore : undefined,
    postedWithinDays: filters.postedWithinDays > 0 ? filters.postedWithinDays : undefined,
  }), [filters]);

  const queryKeyStr = JSON.stringify(query);
  const effQuery = React.useMemo(() => ({ ...query, search: debounced }), [queryKeyStr, debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { setPage(1); }, [jobId, debounced, queryKeyStr]);

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = React.useState(false);
  React.useEffect(() => { setSelectedIds(new Set()); setAllMatching(false); }, [jobId, debounced, queryKeyStr]);

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["linkedin-jobs", jobId, effQuery, page],
    queryFn: () => getCollectedLinkedInJobs(jobId, { ...effQuery, page, pageSize: PAGE_SIZE }),
    refetchInterval: live ? 2000 : false,
    placeholderData: (prev) => prev,
  });

  const rows = data?.jobs ?? [];
  const total = data?.total ?? 0;
  const facets: CollectedLinkedInJobsPage["facets"] | undefined = data?.facets;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageIds = rows.map((r) => r.id);

  const effectiveCount = allMatching ? total : selectedIds.size;
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => allMatching || selectedIds.has(id));
  const someSelected = effectiveCount > 0;

  const rowChecked = (id: string) => allMatching || selectedIds.has(id);
  const toggleRow = (id: string) => {
    if (allMatching) { setAllMatching(false); setSelectedIds(new Set(pageIds.filter((x) => x !== id))); return; }
    setSelectedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const selectThisPage = () => { setAllMatching(false); setSelectedIds((s) => { const n = new Set(s); pageIds.forEach((id) => n.add(id)); return n; }); };
  const selectAll = () => { setSelectedIds(new Set()); setAllMatching(true); };
  const clearSelection = () => { setSelectedIds(new Set()); setAllMatching(false); };
  const toggleHeader = () => { if (someSelected) clearSelection(); else selectThisPage(); };

  const resolveSelected = React.useCallback(async (): Promise<CollectedLinkedInJob[]> => {
    const all = await getCollectedLinkedInJobs(jobId, { ...query, search: debounced, page: 1, pageSize: 100000 });
    return allMatching ? all.jobs : all.jobs.filter((j) => selectedIds.has(j.id));
  }, [jobId, queryKeyStr, debounced, allMatching, selectedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const [busy, setBusy] = React.useState<null | "export" | "people" | "list">(null);

  /** One company lead item per distinct employer behind the current selection. */
  const companyItems = async () => jobsToCompanyLeadItems(
    (await resolveSelected()).map((j) => ({
      name: j.company, location: j.location, linkedin: j.companyLinkedinUrl,
      industry: j.companyIndustry, employees: j.companyEmployeeRange, website: j.companyWebsite,
      logoText: j.companyLogoText,
    })),
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
      const headers = ["Title", "Company", "Location", "Country", "Role family", "Seniority", "Employment", "Industry", "Employees", "Fit", "Qualified", "Posted", "URL"];
      const csv = toCsv(headers, sel.map((j) => [
        j.title, j.company, j.location ?? "", j.country ?? "", j.roleFamily ?? "", j.seniorityLevel ?? "",
        j.employmentType ?? "", j.companyIndustry ?? "", j.companyEmployeeRange ?? "", String(j.fitScore),
        j.qualified ? "yes" : "no", postedLabel(j), j.jobUrl,
      ]));
      downloadCsv(`linkedin-jobs-${jobId}`, csv);
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

  const activeFilterCount = countActive(filters);

  return (
    <div className="flex min-h-0 flex-1">
      {showFilters && (
        <aside className="hidden w-64 shrink-0 flex-col overflow-hidden border-r bg-muted/10 md:flex">
          <LinkedInJobsFilterSidebar filters={filters} onChange={onChangeFilters} activeCount={activeFilterCount} onClear={onClearFilters} facets={facets} />
        </aside>
      )}
      <MobileFilterDrawer open={mobileFilters} onClose={() => setMobileFilters(false)}>
        <LinkedInJobsFilterSidebar filters={filters} onChange={onChangeFilters} activeCount={activeFilterCount} onClear={onClearFilters} facets={facets} />
      </MobileFilterDrawer>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search role, company or location…" className="h-9 pl-9" />
          </div>
          <span className="hidden text-sm text-muted-foreground sm:inline"><span className="font-semibold text-foreground tabular-nums">{formatNumber(total)}</span> roles</span>
          <Button size="sm" variant={showFilters ? "secondary" : "outline"} className="h-9 shrink-0 sm:ml-auto" onClick={() => openFiltersFor(setShowFilters, setMobileFilters)}>
            <SlidersHorizontal className="size-4" /> <span className="hidden sm:inline">Filters</span>{activeFilterCount > 0 && <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary sm:ml-1">{activeFilterCount}</span>}
          </Button>
        </div>

        <div className="min-h-0 flex-1">
          {isLoading && !data ? (
            <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : total === 0 ? (
            <EmptyState
              icon={Briefcase}
              title={live ? "Scraping LinkedIn…" : "No roles found"}
              description={live ? "Roles appear here as each query returns." : "No roles matched the current filter. Try turning off “Qualified only” or clearing filters."}
              className="m-6"
            />
          ) : (
            <>
            <div className={cn("scrollbar-thin h-full space-y-2 overflow-auto p-3 transition-opacity md:hidden", isPlaceholderData && "opacity-60")}>
              {rows.map((j) => {
                const selected = rowChecked(j.id);
                return (
                  <div key={j.id} className={cn("rounded-xl border p-3", selected && "border-primary/40 bg-primary/[0.04]")}>
                    <div className="flex items-start gap-2.5">
                      <div className="pt-0.5" onClick={(e) => e.stopPropagation()}><Check checked={selected} onChange={() => toggleRow(j.id)} /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <a href={j.jobUrl || undefined} target="_blank" rel="noreferrer" className="line-clamp-2 font-medium hover:text-primary hover:underline">{j.title}</a>
                          {j.qualified && <CheckCircle2 className="size-3.5 shrink-0 text-[hsl(var(--valid))]" aria-label="Qualified" />}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CompanyLogo text={j.companyLogoText} seed={j.company} />
                          <span className="min-w-0 truncate">{j.company}</span>
                        </div>
                      </div>
                      <div className="shrink-0"><ScoreBar value={j.fitScore} /></div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[26px] text-xs text-muted-foreground">
                      {j.remote && <span className="rounded bg-muted px-1.5 py-0.5 font-medium">Remote</span>}
                      {j.seniorityLevel && <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{j.seniorityLevel}</span>}
                      {j.primaryLanguage && <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">{j.primaryLanguage}</span>}
                      {j.companyEmployeeRange && <span className="inline-flex items-center gap-1"><Building2 className="size-3 opacity-60" />{j.companyEmployeeRange}</span>}
                      {j.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3 opacity-60" />{j.location}</span>}
                      <span>{postedLabel(j)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={cn("scrollbar-thin hidden h-full overflow-auto transition-opacity md:block", isPlaceholderData && "opacity-60")}>
              <table className="w-full border-collapse text-[13px]">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b text-left font-medium text-muted-foreground">
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
                    <th className="px-3 py-2.5">Job</th>
                    <th className="px-3 py-2.5">Company</th>
                    <th className="px-3 py-2.5">Company employees</th>
                    <th className="px-3 py-2.5">Location</th>
                    <th className="px-3 py-2.5">Role</th>
                    <th className="w-32 px-3 py-2.5">Fit</th>
                    <th className="px-3 py-2.5">Posted</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((j) => {
                    const selected = rowChecked(j.id);
                    return (
                      <tr key={j.id} className={cn("group border-b transition-colors hover:bg-muted/40", selected && "bg-primary/[0.04]")}>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <Check checked={selected} onChange={() => toggleRow(j.id)} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <a href={j.jobUrl || undefined} target="_blank" rel="noreferrer" className="text-left font-medium hover:text-primary hover:underline">{j.title}</a>
                            {j.qualified && <CheckCircle2 className="size-3.5 shrink-0 text-[hsl(var(--valid))]" aria-label="Qualified" />}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            {j.remote && <span className="rounded bg-muted px-1.5 py-0.5 font-medium">Remote</span>}
                            {j.seniorityLevel && <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{j.seniorityLevel}</span>}
                            {j.employmentType && <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{j.employmentType}</span>}
                            {j.primaryLanguage && <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">{j.primaryLanguage}</span>}
                            {!j.qualified && j.rejectReason && <span className="rounded bg-amber-500/12 px-1.5 py-0.5 font-medium text-amber-600 dark:text-amber-400">{j.rejectReason}</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <CompanyLogo text={j.companyLogoText} seed={j.company} />
                            {j.companyLinkedinUrl ? (
                              <a href={j.companyLinkedinUrl} target="_blank" rel="noopener noreferrer" className="line-clamp-1 hover:text-primary hover:underline">{j.company}</a>
                            ) : (
                              <span className="line-clamp-1">{j.company}</span>
                            )}
                          </div>
                          {j.companyIndustry && <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{j.companyIndustry}</div>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {j.companyEmployeeRange ? <span className="inline-flex items-center gap-1"><Building2 className="size-3 opacity-60" />{j.companyEmployeeRange}</span> : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {j.location ? <span className="inline-flex items-center gap-1"><MapPin className="size-3 opacity-60" />{j.location}</span> : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{j.roleFamily ?? "—"}</td>
                        <td className="px-3 py-2"><ScoreBar value={j.fitScore} /></td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{postedLabel(j)}</td>
                        <td className="px-2 py-2">
                          {j.jobUrl && (
                            <a href={j.jobUrl} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100" aria-label="Open role">
                              <ExternalLink className="size-4" />
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

        {total > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
            <span>{formatNumber(total)} roles</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
              <span className="tabular-nums">Page {page} / {totalPages}</span>
              <Button size="sm" variant="outline" className="h-8" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
            </div>
          </div>
        )}

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
              {onFindPeople && (
                <Button size="sm" onClick={findPeople} disabled={findingPeople || busy !== null}>{findingPeople || busy === "people" ? <Loader2 className="size-4 animate-spin" /> : <Users className="size-4" />} Find people</Button>
              )}
              <DropdownMenu up align="end" trigger={<Button size="sm" variant="outline" disabled={busy !== null}>{busy === "list" ? <Loader2 className="size-4 animate-spin" /> : <ListPlus className="size-4" />} Add to list <ChevronDown className="size-3.5" /></Button>}>
                {lists.map((l) => (
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

        {/* New list dialog — name it, then add the selected employers as companies. */}
        <Dialog open={newListOpen} onOpenChange={(o) => { if (!o) { setNewListOpen(false); setNewListName(""); } }}>
          <DialogHeader>
            <DialogTitle>New list</DialogTitle>
            <DialogDescription>Name the list, then add the employers from the {formatNumber(effectiveCount)} selected {effectiveCount === 1 ? "role" : "roles"} as companies.</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={newListName} onChange={(e) => setNewListName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newListName.trim()) createAndAdd(); }} placeholder="List name" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewListOpen(false)}>Cancel</Button>
            <Button disabled={!newListName.trim() || busy === "list"} onClick={createAndAdd}>{busy === "list" ? <Loader2 className="size-4 animate-spin" /> : null} Create &amp; add</Button>
          </DialogFooter>
        </Dialog>
      </div>
    </div>
  );
}

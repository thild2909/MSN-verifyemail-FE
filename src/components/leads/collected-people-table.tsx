"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Inbox, Loader2, ChevronRight, Linkedin, ChevronDown, Bookmark, ListPlus, Download, X, Plus, SlidersHorizontal, MailCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { getCollectedPeople, verifyPersonEmail } from "@/lib/api/client";
import { formatNumber, cn } from "@/lib/utils";
import { getLists, createList, addToList, saveToSaved, type LeadListItem } from "@/lib/leads/lists-store";
import { toCsv, downloadCsv } from "@/lib/leads/csv";
import { Avatar } from "./leads-ui";
import { CompanyLogo, VerificationBadge, LlmBadge } from "./collect-ui";
import { PeopleFilterPanel } from "./people-filter-panel";
import { MobileFilterDrawer, openFiltersFor } from "./filter-drawer";
import { SENIORITY_LABEL, EMPTY_PEOPLE_FILTERS, countPeopleFilters, isUnconfirmedEmail, type PeopleFilters, type CollectedPerson, type PersonSeniority } from "@/lib/leads/people-types";

const PAGE_SIZE = 25;

const SENIORITY_STYLE: Record<PersonSeniority, string> = {
  founder: "bg-[hsl(var(--valid))]/12 text-[hsl(var(--valid))]",
  c_level: "bg-primary/12 text-primary",
  president: "bg-primary/12 text-primary",
  vp: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  other: "bg-muted text-muted-foreground",
};

function Check({ checked, indeterminate, onChange }: { checked: boolean; indeterminate?: boolean; onChange: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      className={cn("flex size-4 items-center justify-center rounded border transition-colors", checked || indeterminate ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:border-primary/50")}
    >
      {indeterminate ? <span className="h-0.5 w-2 rounded bg-current" /> : checked ? (
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      ) : null}
    </button>
  );
}

const linkedinHref = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://${v}`);

export function CollectedPeopleTable({
  jobId,
  live,
  bulkVerifying = false,
  verifyingPersonIds: jobVerifyingIds,
  onOpenPerson,
}: {
  jobId: string;
  live: boolean;
  bulkVerifying?: boolean;
  verifyingPersonIds?: string[];
  onOpenPerson: (p: CollectedPerson) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Per-row "Access email": find + verify ONE person on demand.
  const [verifyingId, setVerifyingId] = React.useState<string | null>(null);
  const verifyOne = useMutation({
    mutationFn: (personId: string) => verifyPersonEmail(jobId, personId),
    onMutate: (personId: string) => setVerifyingId(personId),
    onSettled: () => setVerifyingId(null),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["collect-people", jobId] });
      qc.invalidateQueries({ queryKey: ["people-job", jobId] });
      if (r.status === "not_found") toast({ variant: "info", title: "Email not found", description: "Saved as Not found. Access email will not run again for this person." });
      else if (!r.ok) { toast({ variant: "info", title: "No email to verify", description: "Couldn't find or check an address for this person." }); return; }
      else if (r.status === "valid") toast({ variant: "success", title: "Email verified", description: `${r.email ?? ""} · deliverable` });
      else toast({ variant: r.status === "invalid" || r.status === "disposable" ? "error" : "info", title: r.found ? "Email found" : "Email checked", description: `${r.email ?? ""} · ${r.status ?? "unknown"}` });
    },
    onError: () => toast({ variant: "error", title: "Verify failed" }),
  });
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<PeopleFilters>(EMPTY_PEOPLE_FILTERS);
  const [showFilters, setShowFilters] = React.useState(true);
  const [mobileFilters, setMobileFilters] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);
  const filterKey = JSON.stringify(filters);
  React.useEffect(() => { setPage(1); }, [debounced, filterKey]);

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = React.useState(false);
  React.useEffect(() => { setSelectedIds(new Set()); setAllMatching(false); }, [jobId, debounced, filterKey]);

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["collect-people", jobId, debounced, filterKey, page],
    queryFn: () => getCollectedPeople(jobId, { search: debounced, ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
    refetchInterval: live ? 1500 : false,
  });

  const rows = data?.people ?? [];
  const inflightIds = React.useMemo(() => {
    const s = new Set<string>([
      ...(jobVerifyingIds ?? []),
      ...(data?.verifyingPersonIds ?? []),
    ]);
    if (verifyingId) s.add(verifyingId);
    return s;
  }, [jobVerifyingIds, data?.verifyingPersonIds, verifyingId]);
  const facets = data?.facets;
  const filtersActive = countPeopleFilters(filters);
  const total = data?.total ?? 0;
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

  const resolveSelected = React.useCallback(async (): Promise<CollectedPerson[]> => {
    const all = await getCollectedPeople(jobId, { search: debounced, ...filters, page: 1, pageSize: 100000 });
    return allMatching ? all.people : all.people.filter((p) => selectedIds.has(p.id));
  }, [jobId, debounced, filterKey, allMatching, selectedIds]);

  const [busy, setBusy] = React.useState<null | "export" | "save" | "list">(null);

  const onExport = async () => {
    setBusy("export");
    try {
      // Export exactly what is selected: all "select all N" rows, or the checked
      // rows — every record, regardless of email status (the CSV carries the
      // status column so nothing is hidden). No valid-only filtering.
      const sel = await resolveSelected();
      if (sel.length === 0) {
        toast({ variant: "info", title: "Nothing to export", description: "Select some people (or Select all) first." });
        return;
      }
      const headers = ["Name", "Title", "Seniority", "Company", "Company phone", "Company email", "Company employees", "Company industry", "Email", "Email type", "Email status", "LinkedIn", "Mobile", "Twitter", "Facebook", "Headline", "Department", "Location", "Confidence"];
      const csv = toCsv(headers, sel.map((p) => [
        p.name, p.title?.value ?? "", SENIORITY_LABEL[p.seniority], p.company,
        p.companyPhone ?? "", p.companyEmail ?? "", p.companyEmployees ?? "", p.companyIndustry ?? "",
        p.email?.value ?? "", p.emailKind, p.emailVerification?.status ?? "", p.linkedin?.value ?? "",
        p.mobile ?? "", p.twitter ?? "", p.facebook ?? "", p.headline ?? "", p.department ?? "", p.location ?? "", p.confidence,
      ]));
      downloadCsv(`people-${jobId}`, csv);
      const withValid = sel.filter((p) => p.emailVerification?.status === "valid").length;
      toast({
        variant: "success",
        title: `Exported ${formatNumber(sel.length)} ${sel.length === 1 ? "person" : "people"}`,
        description: withValid < sel.length ? `${formatNumber(withValid)} with a verified-valid email` : undefined,
      });
    } catch { toast({ variant: "error", title: "Export failed" }); }
    finally { setBusy(null); }
  };

  const listItems = (rs: CollectedPerson[]): LeadListItem[] => rs.map((p) => ({ refId: p.id, name: p.name, jobId, kind: "person" as const }));
  const onSave = async () => {
    setBusy("save");
    try { const sel = await resolveSelected(); const { added } = saveToSaved(listItems(sel)); toast({ variant: "success", title: `Saved ${formatNumber(added)} people` }); }
    catch { toast({ variant: "error", title: "Save failed" }); } finally { setBusy(null); }
  };
  const addSelectedToList = async (listId: string, listName: string) => {
    setBusy("list");
    try { const sel = await resolveSelected(); const { added } = addToList(listId, listItems(sel)); toast({ variant: "success", title: `Added ${formatNumber(added)} to ${listName}` }); }
    catch { toast({ variant: "error", title: "Could not add to list" }); } finally { setBusy(null); }
  };

  const [lists, setLists] = React.useState(() => getLists());
  React.useEffect(() => { const h = () => setLists(getLists()); window.addEventListener("leadlists:changed", h); return () => window.removeEventListener("leadlists:changed", h); }, []);

  return (
    <div className="flex min-h-0 flex-1">
      {showFilters && (
        <aside className="hidden w-64 shrink-0 flex-col overflow-hidden border-r bg-muted/10 md:flex">
          <PeopleFilterPanel filters={filters} facets={facets} onChange={setFilters} onClear={() => setFilters(EMPTY_PEOPLE_FILTERS)} />
        </aside>
      )}
      <MobileFilterDrawer open={mobileFilters} onClose={() => setMobileFilters(false)}>
        <PeopleFilterPanel filters={filters} facets={facets} onChange={setFilters} onClear={() => setFilters(EMPTY_PEOPLE_FILTERS)} />
      </MobileFilterDrawer>
      <div className="relative flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="relative w-full min-w-[200px] sm:w-auto sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, title or company…" className="h-9 pl-9" />
        </div>
        <span className="text-sm text-muted-foreground"><span className="font-semibold text-foreground tabular-nums">{formatNumber(total)}</span> people</span>
        <Button size="sm" variant={showFilters ? "secondary" : "outline"} className="ml-auto h-9" onClick={() => openFiltersFor(setShowFilters, setMobileFilters)}>
          <SlidersHorizontal className="size-4" /> Filters{filtersActive > 0 && <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">{filtersActive}</span>}
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : total === 0 ? (
          <EmptyState icon={Inbox} title="No people found yet" description="People appear here as each company is crawled. Try clearing the filter." className="m-6" />
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
                  <th className="px-3 py-2.5 font-medium">Name</th>
                  <th className="px-3 py-2.5 font-medium">Title</th>
                  <th className="px-3 py-2.5 font-medium">Seniority</th>
                  <th className="px-3 py-2.5 font-medium">Company</th>
                  <th className="px-3 py-2.5 font-medium">Company phone</th>
                  <th className="px-3 py-2.5 font-medium">Company email</th>
                  <th className="px-3 py-2.5 font-medium">Company employees</th>
                  <th className="px-3 py-2.5 font-medium">Company industry</th>
                  <th className="px-3 py-2.5 font-medium">Email</th>
                  <th className="px-3 py-2.5 font-medium">LinkedIn</th>
                  <th className="px-3 py-2.5 font-medium">Location</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const selected = rowChecked(p.id);
                  const finding = inflightIds.has(p.id);
                  return (
                    <tr key={p.id} onClick={() => onOpenPerson(p)} className={cn("cursor-pointer border-b hover:bg-muted/30", selected && "bg-primary/[0.04]")}>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><Check checked={selected} onChange={() => toggleRow(p.id)} /></td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={p.name} seed={p.id} />
                          <span className="truncate font-medium">{p.name}</span>
                          {p.llmVerification && <LlmBadge v={p.llmVerification} />}
                        </div>
                      </td>
                      <td className="max-w-[240px] px-3 py-2"><span className="line-clamp-1 text-muted-foreground">{p.title?.value ?? "—"}</span></td>
                      <td className="px-3 py-2"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", SENIORITY_STYLE[p.seniority])}>{SENIORITY_LABEL[p.seniority]}</span></td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <CompanyLogo domain={p.companyDomain} text={p.companyLogoText} className="size-6 text-[10px]" />
                          <span className="line-clamp-1">{p.company}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                        {p.companyPhone ? <a href={`tel:${p.companyPhone}`} className="hover:text-primary">{p.companyPhone}</a> : <span className="text-xs">—</span>}
                      </td>
                      <td className="max-w-[200px] px-3 py-2 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                        {p.companyEmail ? <a href={`mailto:${p.companyEmail}`} className="line-clamp-1 hover:text-primary">{p.companyEmail}</a> : <span className="text-xs">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{p.companyEmployees || <span className="text-xs">—</span>}</td>
                      <td className="max-w-[180px] px-3 py-2 text-muted-foreground"><span className="line-clamp-1">{p.companyIndustry || "—"}</span></td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {p.emailVerification ? (
                          isUnconfirmedEmail(p) ? (
                            <span className="text-xs text-muted-foreground">Not found</span>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs">{String(p.email?.value ?? p.emailVerification.email)}</span>
                              <VerificationBadge ev={p.emailVerification} />
                            </div>
                          )
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1.5 px-2 text-xs"
                            disabled={finding || bulkVerifying}
                            onClick={() => verifyOne.mutate(p.id)}
                            title={finding ? "Finding email…" : "Find & verify this person's email"}
                          >
                            {finding ? <Loader2 className="size-3.5 animate-spin" /> : <MailCheck className="size-3.5" />}
                            {finding ? "Finding…" : "Access email"}
                          </Button>
                        )}
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {p.linkedin ? (
                          <a href={linkedinHref(String(p.linkedin.value))} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary" aria-label="View LinkedIn"><Linkedin className="size-4" /></a>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{p.location ?? "—"}</td>
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
          <span>{formatNumber(total)} people</span>
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
            <Button size="sm" variant="ghost" onClick={onSave} disabled={busy !== null}>{busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Bookmark className="size-4" />} Save</Button>
            <DropdownMenu up align="end" trigger={<Button size="sm" variant="ghost" disabled={busy !== null}>{busy === "list" ? <Loader2 className="size-4 animate-spin" /> : <ListPlus className="size-4" />} Add to list <ChevronDown className="size-3.5" /></Button>}>
              {lists.map((l) => <DropdownItem key={l.id} onClick={() => addSelectedToList(l.id, l.name)}><ListPlus /> {l.name} <span className="ml-auto text-xs text-muted-foreground">{l.items.length}</span></DropdownItem>)}
              {lists.length > 0 && <DropdownSeparator />}
              <DropdownItem onClick={() => { const l = createList(`List ${lists.length + 1}`); addSelectedToList(l.id, l.name); }}><Plus /> New list</DropdownItem>
            </DropdownMenu>
            <Button size="sm" variant="outline" onClick={onExport} disabled={busy !== null} title={allMatching ? "Exports all matching records." : "Exports the checked records (all fields)."}>{busy === "export" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Export</Button>
            <button onClick={clearSelection} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Clear selection"><X className="size-4" /></button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

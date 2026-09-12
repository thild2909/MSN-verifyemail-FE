"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Inbox, Loader2, Trash2, Download, X, Linkedin, ChevronRight, DollarSign, SlidersHorizontal, Columns3, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox as Check, CheckboxIndicator } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getLeadItems, removeLeadItems, type LeadItem, type LeadKind } from "@/lib/api/client";
import { toCsv, downloadCsv } from "@/lib/leads/csv";
import { formatNumber, cn } from "@/lib/utils";
import { Avatar } from "./leads-ui";
import { CompanyLogo, Sourced, VerificationBadge, LlmBadge, COLLECT_STATUS_META } from "./collect-ui";
import { PersonDetailDrawer } from "./people-detail-drawer";
import { CompanyCollectDrawer } from "./company-collect-drawer";
import { PeopleFilterPanel } from "./people-filter-panel";
import { CompanyFilterPanel } from "./company-filter-panel";
import { MobileFilterDrawer, openFiltersFor } from "./filter-drawer";
import { queryPeople } from "@/lib/leads/people-query";
import { queryCompanies } from "@/lib/leads/company-query";
import { EMPTY_PEOPLE_FILTERS, countPeopleFilters, SENIORITY_LABEL, isUnconfirmedEmail, personHasFunding, type PeopleFilters, type CollectedPerson, type PersonSeniority } from "@/lib/leads/people-types";
import { EMPTY_COMPANY_FILTERS, countCompanyFilters, type CompanyFilters, type CollectedCompany } from "@/lib/leads/collect-types";

const PAGE_SIZE = 25;
const linkHref = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://${v}`);

/** Dispatch to the People or Company view — each mirrors its Find Leads tab. */
export function SavedListItemsTable({ listId, listName, kind }: { listId: string; listName?: string; kind: LeadKind }) {
  return kind === "person"
    ? <PeopleListView listId={listId} listName={listName} />
    : <CompanyListView listId={listId} listName={listName} />;
}

/* ------------------------------ shared bits ------------------------------ */

function useAllItems(listId: string, kind: LeadKind) {
  return useQuery({
    queryKey: ["lead-items-all", listId, kind],
    queryFn: () => getLeadItems(listId, { kind, page: 1, pageSize: 100000 }),
  });
}

/** Clickable, sortable column header. Cycles asc → desc → off. */
function SortHeader({ label, field, sortField, sortDir, onSort, align }: {
  label: string; field: string; sortField: string | null; sortDir: "asc" | "desc"; onSort: (f: string) => void; align?: "center";
}) {
  const active = sortField === field;
  return (
    <th className={cn("px-3 py-2.5 font-medium", align === "center" && "text-center")}>
      <button onClick={() => onSort(field)} className="inline-flex items-center gap-1 hover:text-foreground" title={`Sort by ${label}`}>
        {label}
        {active ? (sortDir === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />) : <ArrowUpDown className="size-3.5 opacity-40" />}
      </button>
    </th>
  );
}

function Pagination({ page, totalPages, setPage }: { page: number; totalPages: number; setPage: (fn: (p: number) => number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
      <span className="tabular-nums">Page {page} / {totalPages}</span>
      <Button size="sm" variant="outline" className="h-8" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
    </div>
  );
}

function BulkBar({ effectiveCount, total, selectedSize, allMatching, onSelectAll, onExport, onRemove, onClear, busy }: {
  effectiveCount: number; total: number; selectedSize: number; allMatching: boolean;
  onSelectAll: () => void; onExport: () => void; onRemove: () => void; onClear: () => void; busy: null | "remove" | "export";
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-xl border bg-card/95 p-2 pl-4 shadow-2xl backdrop-blur">
        <span className="flex items-center gap-2 pr-1 text-sm font-semibold">
          <span className="rounded-md bg-primary px-2 py-0.5 text-primary-foreground tabular-nums">{formatNumber(effectiveCount)}</span> selected
        </span>
        {!allMatching && total > selectedSize && (
          <button onClick={onSelectAll} className="text-xs font-medium text-primary hover:underline">Select all {formatNumber(total)}</button>
        )}
        <div className="h-6 w-px bg-border" />
        <Button size="sm" variant="outline" onClick={onExport} disabled={busy !== null}>{busy === "export" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Export</Button>
        <Button size="sm" variant="destructive" onClick={onRemove} disabled={busy !== null}>{busy === "remove" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Remove</Button>
        <button onClick={onClear} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Clear selection"><X className="size-4" /></button>
      </div>
    </div>
  );
}

/** Shared selection + remove/export machinery for a filtered object list. */
function useListSelection<T extends { id: string }>(opts: {
  listId: string; kind: LeadKind; filteredAll: T[]; pageObjs: T[]; dbIdOf: (o: T) => string;
}) {
  const { listId, kind, filteredAll, pageObjs, dbIdOf } = opts;
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = React.useState(false);
  const [busy, setBusy] = React.useState<null | "remove" | "export">(null);

  const total = filteredAll.length;
  const pageIds = pageObjs.map(dbIdOf);
  const effectiveCount = allMatching ? total : selectedIds.size;
  const someSelected = effectiveCount > 0;
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => allMatching || selectedIds.has(id));

  const rowChecked = (id: string) => allMatching || selectedIds.has(id);
  const toggleRow = (id: string) => {
    if (allMatching) { setAllMatching(false); setSelectedIds(new Set(pageIds.filter((x) => x !== id))); return; }
    setSelectedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const selectThisPage = () => { setAllMatching(false); setSelectedIds((s) => { const n = new Set(s); pageIds.forEach((id) => n.add(id)); return n; }); };
  const clearSelection = () => { setSelectedIds(new Set()); setAllMatching(false); };
  const toggleHeader = () => { if (someSelected) clearSelection(); else selectThisPage(); };
  const selectAll = () => { setSelectedIds(new Set()); setAllMatching(true); };
  const resetOnChange = () => { setSelectedIds(new Set()); setAllMatching(false); };

  const selectedObjs = (): T[] => allMatching ? filteredAll : filteredAll.filter((o) => selectedIds.has(dbIdOf(o)));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["lead-items-all", listId, kind] });
    qc.invalidateQueries({ queryKey: ["lead-lists"] });
  };

  const remove = async () => {
    const ids = selectedObjs().map(dbIdOf);
    if (ids.length === 0) { toast({ variant: "info", title: "Nothing selected" }); return; }
    const noun = kind === "person" ? (ids.length === 1 ? "person" : "people") : (ids.length === 1 ? "company" : "companies");
    if (!(await confirm({
      title: `Remove ${formatNumber(ids.length)} ${noun} from list?`,
      description: "They’ll be removed from this list. This can’t be undone.",
      confirmText: "Remove",
    }))) return;
    setBusy("remove");
    try {
      const { removed } = await removeLeadItems(listId, ids);
      clearSelection();
      invalidate();
      toast({ variant: "success", title: `Removed ${formatNumber(removed)} from list` });
    } catch { toast({ variant: "error", title: "Could not remove" }); }
    finally { setBusy(null); }
  };

  return { selectedIds, allMatching, busy, setBusy, total, effectiveCount, someSelected, allPageSelected, rowChecked, toggleRow, selectThisPage, clearSelection, toggleHeader, selectAll, resetOnChange, selectedObjs, remove, toast };
}

/* ------------------------------ People view ------------------------------ */

type ColKey = "title" | "email" | "company" | "companyEmployees" | "companyIndustry" | "seniority" | "companyPhone" | "companyEmail" | "linkedin" | "location";
const COLUMN_DEFS: { key: ColKey; label: string; default: boolean }[] = [
  { key: "title", label: "Title", default: true },
  { key: "email", label: "Email", default: true },
  { key: "company", label: "Company", default: true },
  { key: "companyEmployees", label: "Company employees", default: true },
  { key: "companyIndustry", label: "Company industry", default: true },
  { key: "seniority", label: "Seniority", default: false },
  { key: "companyPhone", label: "Company phone", default: true },
  { key: "companyEmail", label: "Company email", default: false },
  { key: "linkedin", label: "LinkedIn", default: true },
  { key: "location", label: "Location", default: true },
];
const DEFAULT_COLS = Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c.default])) as Record<ColKey, boolean>;
const COL_STORAGE_KEY = "saved-people-table-columns-v1";

function loadCols(): Record<ColKey, boolean> {
  const base = { ...DEFAULT_COLS };
  try {
    const raw = localStorage.getItem(COL_STORAGE_KEY);
    if (raw) { const saved = JSON.parse(raw) as Partial<Record<ColKey, boolean>>; for (const c of COLUMN_DEFS) if (typeof saved[c.key] === "boolean") base[c.key] = saved[c.key]!; }
  } catch { /* ignore */ }
  return base;
}

const SENIORITY_STYLE: Record<PersonSeniority, string> = {
  founder: "bg-[hsl(var(--valid))]/12 text-[hsl(var(--valid))]",
  c_level: "bg-primary/12 text-primary",
  president: "bg-primary/12 text-primary",
  vp: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  other: "bg-muted text-muted-foreground",
};

function PeopleListView({ listId, listName }: { listId: string; listName?: string }) {
  const { data, isLoading } = useAllItems(listId, "person");
  const items = React.useMemo(() => data?.items ?? [], [data]);
  const allPeople = React.useMemo(() => items.map((i) => i.data as unknown as CollectedPerson), [items]);
  const dbIdByRef = React.useMemo(() => new Map(items.map((i) => [i.refId, i.id])), [items]);
  const dbIdOf = React.useCallback((p: CollectedPerson) => dbIdByRef.get(p.id) ?? p.id, [dbIdByRef]);

  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);
  const [filters, setFilters] = React.useState<PeopleFilters>(EMPTY_PEOPLE_FILTERS);
  const [showFilters, setShowFilters] = React.useState(false); // hidden by default on /lists; toggled via the Filters button
  const [mobileFilters, setMobileFilters] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [sortField, setSortField] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");
  const sort = sortField ? (sortDir === "asc" ? sortField : `${sortField}_desc`) : undefined;
  const onSort = (field: string) => {
    if (sortField !== field) { setSortField(field); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortField(null); setSortDir("asc"); }
  };
  const [cols, setCols] = React.useState<Record<ColKey, boolean>>(DEFAULT_COLS);
  React.useEffect(() => { setCols(loadCols()); }, []);
  const toggleCol = (key: ColKey) => setCols((prev) => { const next = { ...prev, [key]: !prev[key] }; try { localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ } return next; });
  const resetCols = () => { setCols(DEFAULT_COLS); try { localStorage.removeItem(COL_STORAGE_KEY); } catch { /* ignore */ } };
  const show = (k: ColKey) => cols[k];

  const filterKey = JSON.stringify(filters);
  React.useEffect(() => { setPage(1); }, [debounced, filterKey, sortField, sortDir]);

  const filteredAll = React.useMemo(
    () => queryPeople(allPeople, { search: debounced, ...filters, sort, page: 1, pageSize: 1_000_000 }).people,
    [allPeople, debounced, filterKey, sort],
  );
  const view = React.useMemo(
    () => queryPeople(allPeople, { search: debounced, ...filters, sort, page, pageSize: PAGE_SIZE }),
    [allPeople, debounced, filterKey, sort, page],
  );
  const rows = view.people;
  const facets = view.facets;
  const total = view.total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtersActive = countPeopleFilters(filters);

  const sel = useListSelection({ listId, kind: "person", filteredAll, pageObjs: rows, dbIdOf });
  React.useEffect(() => { sel.resetOnChange(); }, [debounced, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [drawer, setDrawer] = React.useState<CollectedPerson | null>(null);

  const onExport = async () => {
    sel.setBusy("export");
    try {
      const chosen = sel.selectedObjs();
      if (chosen.length === 0) { sel.toast({ variant: "info", title: "Nothing to export", description: "Select some people first." }); return; }
      const headers = ["First Name", "Last Name", "Company Name", "Email", "Full Name", "LinkedIn", "Title", "Industry", "Employees Count", "Location"];
      const csv = toCsv(headers, chosen.map((p) => [
        p.firstName, p.lastName, p.company, p.email?.value ?? "", p.name, p.linkedin?.value ?? "",
        p.title?.value ?? "", p.companyIndustry ?? "", p.companyEmployees ?? "", p.location ?? "",
      ]));
      downloadCsv(`${(listName?.trim() || `list-${listId}`)}-people`, csv);
      sel.toast({ variant: "success", title: `Exported ${formatNumber(chosen.length)} ${chosen.length === 1 ? "person" : "people"}` });
    } catch { sel.toast({ variant: "error", title: "Export failed" }); }
    finally { sel.setBusy(null); }
  };

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {showFilters && (
        <aside className="hidden w-64 shrink-0 flex-col overflow-hidden border-r bg-muted/10 md:flex">
          <PeopleFilterPanel filters={filters} facets={facets} onChange={setFilters} onClear={() => setFilters(EMPTY_PEOPLE_FILTERS)} />
        </aside>
      )}
      <MobileFilterDrawer open={mobileFilters} onClose={() => setMobileFilters(false)}>
        <PeopleFilterPanel filters={filters} facets={facets} onChange={setFilters} onClear={() => setFilters(EMPTY_PEOPLE_FILTERS)} />
      </MobileFilterDrawer>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-1 py-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, title or company…" className="h-9 pl-9" />
          </div>
          <span className="hidden text-sm text-muted-foreground sm:inline"><span className="font-semibold text-foreground tabular-nums">{formatNumber(total)}</span> people</span>
          <div className="flex shrink-0 items-center gap-1.5 sm:ml-auto sm:gap-2">
            <ColumnsMenu defs={COLUMN_DEFS} cols={cols} onToggle={toggleCol} onReset={resetCols} />
            <Button size="sm" variant={showFilters ? "secondary" : "outline"} className="h-9" onClick={() => openFiltersFor(setShowFilters, setMobileFilters)}>
              <SlidersHorizontal className="size-4" /> <span className="hidden sm:inline">Filters</span>{filtersActive > 0 && <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary sm:ml-1">{filtersActive}</span>}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : total === 0 ? (
            (filtersActive > 0 || debounced) ? (
              <EmptyState icon={Search} title="No people match your filters" description="Try removing some filters or the search." action={<Button variant="outline" onClick={() => { setFilters(EMPTY_PEOPLE_FILTERS); setSearch(""); }}><X className="size-4" /> Clear filters</Button>} className="m-6" />
            ) : (
              <EmptyState icon={Inbox} title="No people in this list" description="Add people from Find Leads." className="m-6" />
            )
          ) : (
            <>
            {/* Mobile: people cards */}
            <div className="scrollbar-thin h-full space-y-2 overflow-auto p-3 md:hidden">
              {rows.map((p) => {
                const id = dbIdOf(p);
                const selected = sel.rowChecked(id);
                return (
                  <div key={id} onClick={() => setDrawer(p)} className={cn("rounded-xl border p-3 transition-colors active:bg-muted/40", selected && "border-primary/40 bg-primary/[0.04]")}>
                    <div className="flex items-start gap-2.5">
                      <div className="pt-0.5" onClick={(e) => e.stopPropagation()}><Check checked={selected} onChange={() => sel.toggleRow(id)} /></div>
                      <Avatar name={p.name || "?"} seed={p.id} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="min-w-0 truncate font-medium">{p.name || "—"}</span>
                          {personHasFunding(p) && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[hsl(var(--valid))]/10 px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--valid))]"><DollarSign className="size-3" /> Funded</span>}
                          {p.llmVerification && <LlmBadge v={p.llmVerification} />}
                        </div>
                        {p.title?.value && <p className="truncate text-xs text-muted-foreground">{p.title.value}</p>}
                      </div>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                    </div>
                    <div className="mt-2 space-y-1.5 pl-[26px] text-xs">
                      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <CompanyLogo domain={p.companyDomain} text={p.companyLogoText || (p.company || "").slice(0, 2).toUpperCase()} className="size-5 shrink-0 text-[9px]" />
                        <span className="min-w-0 truncate">{p.company || "—"}</span>
                        <span className={cn("ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", SENIORITY_STYLE[p.seniority])}>{SENIORITY_LABEL[p.seniority]}</span>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        {p.emailVerification ? (
                          isUnconfirmedEmail(p) ? <span className="text-muted-foreground">Not found</span>
                            : <div className="flex flex-wrap items-center gap-1.5"><span className="break-all">{String(p.email?.value ?? p.emailVerification.email)}</span><VerificationBadge ev={p.emailVerification} /></div>
                        ) : p.email ? (
                          <div className="flex flex-wrap items-center gap-1.5"><span className="break-all">{String(p.email.value)}</span><span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Not verified</span></div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                        {p.linkedin && <a href={linkHref(String(p.linkedin.value))} target="_blank" rel="noreferrer" className="hover:text-primary" aria-label="LinkedIn"><Linkedin className="size-4" /></a>}
                        {p.location && <span className="min-w-0 truncate">{p.location}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop: table */}
            <div className="scrollbar-thin hidden h-full overflow-auto md:block">
              <table className="w-full border-collapse text-[13px]">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="w-10 px-3 py-2.5"><Check checked={sel.allMatching || sel.allPageSelected} indeterminate={sel.someSelected && !sel.allMatching && !sel.allPageSelected} onChange={sel.toggleHeader} /></th>
                    <SortHeader label="Name" field="name" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                    {show("title") && <SortHeader label="Title" field="title" sortField={sortField} sortDir={sortDir} onSort={onSort} />}
                    {show("email") && <SortHeader label="Email" field="email" sortField={sortField} sortDir={sortDir} onSort={onSort} />}
                    {show("company") && <SortHeader label="Company" field="company" sortField={sortField} sortDir={sortDir} onSort={onSort} />}
                    {show("companyEmployees") && <SortHeader label="Company employees" field="companyEmployees" sortField={sortField} sortDir={sortDir} onSort={onSort} align="center" />}
                    {show("companyIndustry") && <SortHeader label="Company industry" field="companyIndustry" sortField={sortField} sortDir={sortDir} onSort={onSort} />}
                    {show("seniority") && <SortHeader label="Seniority" field="seniority" sortField={sortField} sortDir={sortDir} onSort={onSort} />}
                    {show("companyPhone") && <SortHeader label="Company phone" field="companyPhone" sortField={sortField} sortDir={sortDir} onSort={onSort} />}
                    {show("companyEmail") && <SortHeader label="Company email" field="companyEmail" sortField={sortField} sortDir={sortDir} onSort={onSort} />}
                    {show("linkedin") && <SortHeader label="LinkedIn" field="linkedin" sortField={sortField} sortDir={sortDir} onSort={onSort} />}
                    {show("location") && <SortHeader label="Location" field="location" sortField={sortField} sortDir={sortDir} onSort={onSort} />}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const id = dbIdOf(p);
                    const selected = sel.rowChecked(id);
                    return (
                      <tr key={id} onClick={() => setDrawer(p)} className={cn("cursor-pointer border-b hover:bg-muted/30", selected && "bg-primary/[0.04]")}>
                        <td className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}><Check checked={selected} onChange={() => sel.toggleRow(id)} /></td>
                        <td className="min-w-[160px] max-w-[240px] px-3 py-2 align-top">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Avatar name={p.name || "?"} seed={p.id} />
                            <span className="min-w-0 truncate font-medium">{p.name || "—"}</span>
                            {personHasFunding(p) && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[hsl(var(--valid))]/10 px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--valid))]" title={`Company funding: ${p.companyFunding}`}><DollarSign className="size-3" /> Funded</span>}
                            {p.llmVerification && <LlmBadge v={p.llmVerification} />}
                          </div>
                        </td>
                        {show("title") && <td className="min-w-[200px] max-w-[420px] px-3 py-2 align-top text-muted-foreground"><span className="whitespace-normal break-words">{p.title?.value ?? "—"}</span></td>}
                        {show("email") && (
                          <td className="min-w-[220px] max-w-[360px] px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}>
                            {p.emailVerification ? (
                              isUnconfirmedEmail(p) ? <span className="text-xs text-muted-foreground">Not found</span>
                                : <div className="flex flex-col gap-1"><span className="break-all text-xs">{String(p.email?.value ?? p.emailVerification.email)}</span><div><VerificationBadge ev={p.emailVerification} /></div></div>
                            ) : p.email ? (
                              <div className="flex flex-col gap-1"><span className="break-all text-xs">{String(p.email.value)}</span><span className="w-fit rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Not verified</span></div>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                        )}
                        {show("company") && (
                          <td className="min-w-[200px] max-w-[380px] px-3 py-2 align-top">
                            <div className="flex min-w-0 items-start gap-2">
                              <CompanyLogo domain={p.companyDomain} text={p.companyLogoText || (p.company || "").slice(0, 2).toUpperCase()} className="mt-0.5 size-6 text-[10px]" />
                              <span className="whitespace-normal break-words">{p.company || "—"}</span>
                            </div>
                          </td>
                        )}
                        {show("companyEmployees") && <td className="whitespace-nowrap px-3 py-2 text-center align-top text-muted-foreground">{p.companyEmployees || <span className="text-xs">—</span>}</td>}
                        {show("companyIndustry") && <td className="min-w-[140px] max-w-[240px] px-3 py-2 align-top text-muted-foreground"><span className="whitespace-normal break-words">{p.companyIndustry || "—"}</span></td>}
                        {show("seniority") && <td className="px-3 py-2 align-top"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", SENIORITY_STYLE[p.seniority])}>{SENIORITY_LABEL[p.seniority]}</span></td>}
                        {show("companyPhone") && <td className="whitespace-nowrap px-3 py-2 align-top text-muted-foreground" onClick={(e) => e.stopPropagation()}>{p.companyPhone ? <a href={`tel:${p.companyPhone}`} className="hover:text-primary">{p.companyPhone}</a> : <span className="text-xs">—</span>}</td>}
                        {show("companyEmail") && <td className="max-w-[220px] px-3 py-2 align-top text-muted-foreground" onClick={(e) => e.stopPropagation()}>{p.companyEmail ? <a href={`mailto:${p.companyEmail}`} className="line-clamp-1 hover:text-primary">{p.companyEmail}</a> : <span className="text-xs">—</span>}</td>}
                        {show("linkedin") && <td className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}>{p.linkedin ? <a href={linkHref(String(p.linkedin.value))} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary" aria-label="View LinkedIn"><Linkedin className="size-4" /></a> : <span className="text-xs text-muted-foreground">—</span>}</td>}
                        {show("location") && <td className="whitespace-nowrap px-3 py-2 align-top text-muted-foreground">{p.location ?? "—"}</td>}
                        <td className="px-2 py-2 text-right align-top"><ChevronRight className="size-4 text-muted-foreground" /></td>
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
          <div className="flex items-center justify-between border-t px-1 py-2 text-sm text-muted-foreground">
            <span>{formatNumber(total)} people</span>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} />
          </div>
        )}

        {sel.someSelected && <BulkBar effectiveCount={sel.effectiveCount} total={total} selectedSize={sel.selectedIds.size} allMatching={sel.allMatching} onSelectAll={sel.selectAll} onExport={onExport} onRemove={sel.remove} onClear={sel.clearSelection} busy={sel.busy} />}
        <PersonDetailDrawer person={drawer} open={!!drawer} onOpenChange={(o) => !o && setDrawer(null)} />
      </div>
    </div>
  );
}

/** Column show/hide picker (own popover, stays open across toggles). Generic
 *  over the column key so the People and Company views can share it. */
function ColumnsMenu<K extends string>({ defs, cols, onToggle, onReset }: {
  defs: readonly { key: K; label: string; default: boolean }[];
  cols: Record<K, boolean>;
  onToggle: (k: K) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const shown = defs.filter((c) => cols[c.key]).length;
  return (
    <div ref={ref} className="relative inline-block text-left">
      <Button size="sm" variant="outline" className="h-9" onClick={() => setOpen((o) => !o)}>
        <Columns3 className="size-4" /> <span className="hidden sm:inline">Columns</span>
        <span className="ml-0.5 rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground tabular-nums sm:ml-1">{shown}</span>
      </Button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-56 animate-fade-in rounded-lg border bg-popover p-1.5 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Show columns</span>
            <button onClick={onReset} className="text-[11px] font-medium text-primary hover:underline">Reset</button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {defs.map((c) => (
              <label key={c.key} className="group flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent">
                <CheckboxIndicator checked={cols[c.key]} />
                <input type="checkbox" className="sr-only" checked={cols[c.key]} onChange={() => onToggle(c.key)} />
                <span className="flex-1">{c.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------- Company column config ------------------------- */

type CompanyColKey = "company" | "employees" | "industry" | "website" | "email" | "phone" | "linkedin" | "location" | "status";
const COMPANY_COLUMN_DEFS: { key: CompanyColKey; label: string; default: boolean }[] = [
  { key: "company", label: "Company", default: true },
  { key: "employees", label: "Employees", default: true },
  { key: "industry", label: "Industry", default: false },
  { key: "website", label: "Website", default: false },
  { key: "email", label: "Email", default: false },
  { key: "phone", label: "Phone", default: false },
  { key: "linkedin", label: "LinkedIn", default: true },
  { key: "location", label: "Location", default: true },
  { key: "status", label: "Status", default: true },
];
const COMPANY_DEFAULT_COLS = Object.fromEntries(COMPANY_COLUMN_DEFS.map((c) => [c.key, c.default])) as Record<CompanyColKey, boolean>;
const COMPANY_COL_STORAGE_KEY = "saved-company-table-columns-v1";

function loadCompanyCols(): Record<CompanyColKey, boolean> {
  const base = { ...COMPANY_DEFAULT_COLS };
  try {
    const raw = localStorage.getItem(COMPANY_COL_STORAGE_KEY);
    if (raw) { const saved = JSON.parse(raw) as Partial<Record<CompanyColKey, boolean>>; for (const c of COMPANY_COLUMN_DEFS) if (typeof saved[c.key] === "boolean") base[c.key] = saved[c.key]!; }
  } catch { /* ignore */ }
  return base;
}

/* ------------------------------ Company view ----------------------------- */

function CompanyListView({ listId, listName }: { listId: string; listName?: string }) {
  const { data, isLoading } = useAllItems(listId, "company");
  const items = React.useMemo(() => data?.items ?? [], [data]);
  const allCompanies = React.useMemo(() => items.map((i) => i.data as unknown as CollectedCompany), [items]);
  const dbIdByRef = React.useMemo(() => new Map(items.map((i) => [i.refId, i.id])), [items]);
  const dbIdOf = React.useCallback((c: CollectedCompany) => dbIdByRef.get(c.id) ?? c.id, [dbIdByRef]);

  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);
  const [filters, setFilters] = React.useState<CompanyFilters>(EMPTY_COMPANY_FILTERS);
  const [showFilters, setShowFilters] = React.useState(false); // hidden by default on /lists; toggled via the Filters button
  const [mobileFilters, setMobileFilters] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const filterKey = JSON.stringify(filters);
  React.useEffect(() => { setPage(1); }, [debounced, filterKey]);

  const filteredAll = React.useMemo(
    () => queryCompanies(allCompanies, { search: debounced, ...filters, page: 1, pageSize: 1_000_000 }).companies,
    [allCompanies, debounced, filterKey],
  );
  const view = React.useMemo(
    () => queryCompanies(allCompanies, { search: debounced, ...filters, page, pageSize: PAGE_SIZE }),
    [allCompanies, debounced, filterKey, page],
  );
  const rows = view.companies;
  const facets = view.facets;
  const total = view.total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtersActive = countCompanyFilters(filters);

  const [cols, setCols] = React.useState<Record<CompanyColKey, boolean>>(COMPANY_DEFAULT_COLS);
  React.useEffect(() => { setCols(loadCompanyCols()); }, []);
  const toggleCol = (key: CompanyColKey) => setCols((prev) => { const next = { ...prev, [key]: !prev[key] }; try { localStorage.setItem(COMPANY_COL_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ } return next; });
  const resetCols = () => { setCols(COMPANY_DEFAULT_COLS); try { localStorage.removeItem(COMPANY_COL_STORAGE_KEY); } catch { /* ignore */ } };
  const show = (k: CompanyColKey) => cols[k];

  const sel = useListSelection({ listId, kind: "company", filteredAll, pageObjs: rows, dbIdOf });
  React.useEffect(() => { sel.resetOnChange(); }, [debounced, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [drawer, setDrawer] = React.useState<CollectedCompany | null>(null);

  const onExport = async () => {
    sel.setBusy("export");
    try {
      const chosen = sel.selectedObjs();
      if (chosen.length === 0) { sel.toast({ variant: "info", title: "Nothing to export", description: "Select some companies first." }); return; }
      const headers = ["Company", "Employees", "Industry", "Website", "Email", "Phone", "LinkedIn", "Location"];
      const csv = toCsv(headers, chosen.map((c) => [
        c.inputName, c.employees?.value ?? "", c.industry?.value ?? "", c.website?.value ?? "",
        c.contactEmail?.value ?? "", c.phone?.value ?? "", c.linkedin?.value ?? "", c.address?.value ?? c.inputLocation,
      ]));
      downloadCsv(`${(listName?.trim() || `list-${listId}`)}-companies`, csv);
      sel.toast({ variant: "success", title: `Exported ${formatNumber(chosen.length)} companies` });
    } catch { sel.toast({ variant: "error", title: "Export failed" }); }
    finally { sel.setBusy(null); }
  };

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {showFilters && (
        <aside className="hidden w-64 shrink-0 flex-col overflow-hidden border-r bg-muted/10 md:flex">
          <CompanyFilterPanel filters={filters} facets={facets} onChange={setFilters} onClear={() => setFilters(EMPTY_COMPANY_FILTERS)} />
        </aside>
      )}
      <MobileFilterDrawer open={mobileFilters} onClose={() => setMobileFilters(false)}>
        <CompanyFilterPanel filters={filters} facets={facets} onChange={setFilters} onClear={() => setFilters(EMPTY_COMPANY_FILTERS)} />
      </MobileFilterDrawer>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-1 py-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company or location…" className="h-9 pl-9" />
          </div>
          <span className="hidden text-sm text-muted-foreground sm:inline"><span className="font-semibold text-foreground tabular-nums">{formatNumber(total)}</span> companies</span>
          <div className="flex shrink-0 items-center gap-1.5 sm:ml-auto sm:gap-2">
            <ColumnsMenu defs={COMPANY_COLUMN_DEFS} cols={cols} onToggle={toggleCol} onReset={resetCols} />
            <Button size="sm" variant={showFilters ? "secondary" : "outline"} className="h-9" onClick={() => openFiltersFor(setShowFilters, setMobileFilters)}>
              <SlidersHorizontal className="size-4" /> <span className="hidden sm:inline">Filters</span>{filtersActive > 0 && <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary sm:ml-1">{filtersActive}</span>}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : total === 0 ? (
            (filtersActive > 0 || debounced) ? (
              <EmptyState icon={Search} title="No companies match your filters" description="Try removing some filters or the search." action={<Button variant="outline" onClick={() => { setFilters(EMPTY_COMPANY_FILTERS); setSearch(""); }}><X className="size-4" /> Clear filters</Button>} className="m-6" />
            ) : (
              <EmptyState icon={Inbox} title="No companies in this list" description="Add companies from Find Leads." className="m-6" />
            )
          ) : (
            <>
            {/* Mobile: company cards */}
            <div className="scrollbar-thin h-full space-y-2 overflow-auto p-3 md:hidden">
              {rows.map((c) => {
                const id = dbIdOf(c);
                const selected = sel.rowChecked(id);
                const st = COLLECT_STATUS_META[c.status] ?? COLLECT_STATUS_META.enriched;
                return (
                  <div key={id} onClick={() => setDrawer(c)} className={cn("rounded-xl border p-3 transition-colors active:bg-muted/40", selected && "border-primary/40 bg-primary/[0.04]")}>
                    <div className="flex items-start gap-2.5">
                      <div className="pt-0.5" onClick={(e) => e.stopPropagation()}><Check checked={selected} onChange={() => sel.toggleRow(id)} /></div>
                      <CompanyLogo domain={c.domainGuess} text={c.logoText || (c.inputName || "").slice(0, 2).toUpperCase()} className="size-9 shrink-0 text-[11px]" />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate font-medium">{c.inputName}{c.llmVerification && <LlmBadge v={c.llmVerification} />}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.inputLocation}{c.domainGuess ? ` · ${c.domainGuess}` : ""}</p>
                      </div>
                      {show("status") && <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", st.className)}>{st.label}</span>}
                    </div>
                    <div className="mt-2 space-y-1 pl-[26px] text-xs" onClick={(e) => e.stopPropagation()}>
                      {show("email") && (c.contactEmail?.value != null || c.emailVerification) && <div className="flex min-w-0 items-center gap-1.5"><Sourced field={c.contactEmail} />{c.emailVerification && <VerificationBadge ev={c.emailVerification} />}</div>}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                        {show("employees") && c.employees?.value != null && <span>Emp <Sourced field={c.employees} /></span>}
                        {show("industry") && c.industry?.value != null && <span className="min-w-0"><Sourced field={c.industry} /></span>}
                        {show("website") && c.website?.value != null && <span className="min-w-0"><Sourced field={c.website} /></span>}
                        {show("linkedin") && c.linkedin?.value != null && <span className="min-w-0"><Sourced field={c.linkedin} /></span>}
                        {show("location") && (c.address?.value != null || c.inputLocation) && <span className="min-w-0">{c.address?.value ?? c.inputLocation}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop: table */}
            <div className="scrollbar-thin hidden h-full overflow-auto md:block">
              <table className="w-full border-collapse text-[13px]">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="w-10 px-3 py-2.5"><Check checked={sel.allMatching || sel.allPageSelected} indeterminate={sel.someSelected && !sel.allMatching && !sel.allPageSelected} onChange={sel.toggleHeader} /></th>
                    {show("company") && <th className="px-3 py-2.5 font-medium">Company</th>}
                    {show("employees") && <th className="px-3 py-2.5 font-medium">Employees</th>}
                    {show("industry") && <th className="px-3 py-2.5 font-medium">Industry</th>}
                    {show("website") && <th className="px-3 py-2.5 font-medium">Website</th>}
                    {show("email") && <th className="px-3 py-2.5 font-medium">Email</th>}
                    {show("phone") && <th className="px-3 py-2.5 font-medium">Phone</th>}
                    {show("linkedin") && <th className="px-3 py-2.5 font-medium">LinkedIn</th>}
                    {show("location") && <th className="px-3 py-2.5 font-medium">Location</th>}
                    {show("status") && <th className="px-3 py-2.5 font-medium">Status</th>}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const id = dbIdOf(c);
                    const selected = sel.rowChecked(id);
                    const st = COLLECT_STATUS_META[c.status] ?? COLLECT_STATUS_META.enriched;
                    return (
                      <tr key={id} onClick={() => setDrawer(c)} className={cn("cursor-pointer border-b hover:bg-muted/30", selected && "bg-primary/[0.04]")}>
                        <td className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}><Check checked={selected} onChange={() => sel.toggleRow(id)} /></td>
                        {show("company") && (
                          <td className="px-3 py-2 align-top">
                            <div className="flex items-center gap-2.5">
                              <CompanyLogo domain={c.domainGuess} text={c.logoText || (c.inputName || "").slice(0, 2).toUpperCase()} className="size-8 text-[11px]" />
                              <div className="min-w-0">
                                <p className="flex items-center gap-1.5 truncate font-medium">{c.inputName}{c.llmVerification && <LlmBadge v={c.llmVerification} />}</p>
                                <p className="truncate text-xs text-muted-foreground">{c.inputLocation}{c.domainGuess ? ` · ${c.domainGuess}` : ""}{c.resolution && c.resolution.confidence > 0 ? ` · ${c.resolution.confidence}% match` : ""}</p>
                              </div>
                            </div>
                          </td>
                        )}
                        {show("employees") && <td className="px-3 py-2 align-top"><Sourced field={c.employees} showConfidence /></td>}
                        {show("industry") && <td className="px-3 py-2 align-top"><Sourced field={c.industry} /></td>}
                        {show("website") && <td className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}><Sourced field={c.website} /></td>}
                        {show("email") && <td className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}><div className="flex items-center gap-1.5"><Sourced field={c.contactEmail} />{c.emailVerification && <VerificationBadge ev={c.emailVerification} />}</div></td>}
                        {show("phone") && <td className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}><Sourced field={c.phone} /></td>}
                        {show("linkedin") && <td className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}><Sourced field={c.linkedin} /></td>}
                        {show("location") && <td className="px-3 py-2 align-top">{c.address ? <Sourced field={c.address} /> : <span className="text-xs text-muted-foreground">{c.inputLocation || "—"}</span>}</td>}
                        {show("status") && <td className="px-3 py-2 align-top"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", st.className)}>{st.label}</span></td>}
                        <td className="px-2 py-2 text-right align-top"><ChevronRight className="size-4 text-muted-foreground" /></td>
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
          <div className="flex items-center justify-between border-t px-1 py-2 text-sm text-muted-foreground">
            <span>{formatNumber(total)} companies</span>
            <Pagination page={page} totalPages={totalPages} setPage={setPage} />
          </div>
        )}

        {sel.someSelected && <BulkBar effectiveCount={sel.effectiveCount} total={total} selectedSize={sel.selectedIds.size} allMatching={sel.allMatching} onSelectAll={sel.selectAll} onExport={onExport} onRemove={sel.remove} onClear={sel.clearSelection} busy={sel.busy} />}
        <CompanyCollectDrawer company={drawer} open={!!drawer} onOpenChange={(o) => !o && setDrawer(null)} />
      </div>
    </div>
  );
}

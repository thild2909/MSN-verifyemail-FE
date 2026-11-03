"use client";
import { ColHead } from "@/components/common/col-head";
import { ColumnsMenu as SharedColumnsMenu } from "./columns-menu";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Inbox, Loader2, Trash2, Download, X, Linkedin, ChevronRight, DollarSign, SlidersHorizontal, Columns3, ArrowUp, ArrowDown, ArrowUpDown, CheckCircle2, Clock, SearchX, XCircle } from "lucide-react";
import { Pill, type Tone } from "@/components/common/kit";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox as Check, CheckboxIndicator } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getLeadItems, removeLeadItems, type LeadItem, type LeadKind } from "@/lib/api/client";
import { toCsv, downloadCsv } from "@/lib/leads/csv";
import { peopleExportTable } from "@/lib/leads/people-export";
import { formatNumber, cn } from "@/lib/utils";
import { Avatar } from "./leads-ui";
import { CompanyLogo, Sourced, VerificationBadge, LlmBadge, COLLECT_STATUS_META } from "./collect-ui";
import { PersonDetailDrawer } from "./people-detail-drawer";
import { StatsBar, StatChip } from "./stats-bar";
import { Users, MailCheck, MailX, MailQuestion, Mail, Star, Crown, Building2, Globe, Phone } from "lucide-react";
import { CompanyCollectDrawer } from "./company-collect-drawer";
import { PeopleFilterPanel } from "./people-filter-panel";
import { CompanyFilterPanel } from "./company-filter-panel";
import { MobileFilterDrawer, openFiltersFor } from "./filter-drawer";
import { queryPeople } from "@/lib/leads/people-query";
import { queryCompanies } from "@/lib/leads/company-query";
import { EMPTY_PEOPLE_FILTERS, countPeopleFilters, SENIORITY_LABEL, isUnconfirmedEmail, personHasFunding, type PeopleFilters, type CollectedPerson, type PersonSeniority } from "@/lib/leads/people-types";
import { EMPTY_COMPANY_FILTERS, countCompanyFilters, type CompanyFilters, type CollectedCompany, type CollectStatus } from "@/lib/leads/collect-types";

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
    <th className={cn("whitespace-nowrap px-3 py-3 font-normal", align === "center" && "text-center")}>
      <button onClick={() => onSort(field)} className={cn("group/sort inline-flex items-center gap-1 transition-colors hover:text-foreground", active && "text-brand")} title={`Sort by ${label}`}>
        <ColHead label={label} />
        {active ? (sortDir === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />) : <ArrowUpDown className="size-3.5 opacity-30 transition-opacity group-hover/sort:opacity-70" />}
      </button>
    </th>
  );
}

function Pagination({ page, totalPages, setPage }: { page: number; totalPages: number; setPage: (fn: (p: number) => number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
      <span className="rounded-md bg-surface px-2 py-1 font-medium tabular-nums text-foreground">Page {page} / {totalPages}</span>
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
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-card/95 p-2 pl-3 shadow-pop backdrop-blur">
        <span className="flex items-center gap-2 pr-1 text-sm font-semibold">
          <span className="rounded-md bg-brand/10 px-2 py-0.5 text-brand tabular-nums">{formatNumber(effectiveCount)}</span> selected
        </span>
        {!allMatching && total > selectedSize && (
          <button onClick={onSelectAll} className="text-xs font-medium text-brand hover:underline">Select all {formatNumber(total)}</button>
        )}
        <div className="h-6 w-px bg-border" />
        <Button size="sm" variant="outline" onClick={onExport} disabled={busy !== null}>{busy === "export" ? <Loader2 className="animate-spin" /> : <Download />} Export</Button>
        <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onRemove} disabled={busy !== null}>{busy === "remove" ? <Loader2 className="animate-spin" /> : <Trash2 />} Remove</Button>
        <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" onClick={onClear} aria-label="Clear selection"><X /></Button>
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

const SENIORITY_TONE: Record<PersonSeniority, Tone> = {
  founder: "valid",
  c_level: "brand",
  president: "violet",
  vp: "risky",
  other: "muted",
};

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

/** Small "Funded" chip shared by the mobile card and the table. */
function FundedPill({ title }: { title?: string }) {
  return <span title={title} className="shrink-0"><Pill tone="valid" className="normal-case"><DollarSign className="size-3" strokeWidth={2} /> Funded</Pill></span>;
}

/** Empty-cell placeholder, same as the People table. */
const DASH = <span className="text-muted-foreground/60">—</span>;

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
      // Same columns as the imported CSV(s) (or the full Apollo layout), current values.
      const { headers, rows } = peopleExportTable(chosen);
      const csv = toCsv(headers, rows);
      downloadCsv(`${(listName?.trim() || `list-${listId}`)}-people`, csv);
      sel.toast({ variant: "success", title: `Exported ${formatNumber(chosen.length)} ${chosen.length === 1 ? "person" : "people"}` });
    } catch { sel.toast({ variant: "error", title: "Export failed" }); }
    finally { sel.setBusy(null); }
  };

  return (
    <div className="relative flex min-h-0 flex-1 overflow-clip">
      {showFilters && (
        <aside className="hidden w-64 shrink-0 flex-col overflow-clip border-r border-border bg-card md:flex">
          <PeopleFilterPanel filters={filters} facets={facets} onChange={setFilters} onClear={() => setFilters(EMPTY_PEOPLE_FILTERS)} />
        </aside>
      )}
      <MobileFilterDrawer open={mobileFilters} onClose={() => setMobileFilters(false)}>
        <PeopleFilterPanel filters={filters} facets={facets} onChange={setFilters} onClear={() => setFilters(EMPTY_PEOPLE_FILTERS)} />
      </MobileFilterDrawer>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2.5 sm:px-6">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, title or company…" type="search" autoComplete="off" data-1p-ignore data-lpignore="true" className="h-9 pl-9" />
          </div>
          <span className="hidden shrink-0 items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-xs text-muted-foreground sm:inline-flex"><span className="font-semibold text-foreground tabular-nums">{formatNumber(total)}</span> people</span>
          <div className="flex shrink-0 items-center gap-1.5 sm:ml-auto sm:gap-2">
            <ColumnsMenu defs={COLUMN_DEFS} cols={cols} onToggle={toggleCol} onReset={resetCols} />
            <Button size="sm" variant={showFilters ? "brand" : "outline"} className="h-9" onClick={() => openFiltersFor(setShowFilters, setMobileFilters)}>
              <SlidersHorizontal /> <span className="hidden sm:inline">Filters</span>{filtersActive > 0 && <span className="ml-0.5 rounded-md bg-brand/10 px-1.5 py-px text-[10px] font-semibold tabular-nums text-brand sm:ml-1">{filtersActive}</span>}
            </Button>
          </div>
        </div>


        {/* Stats — same rail as Find Leads (counts over the whole list) */}
        <StatsBar summary={`${formatNumber(allPeople.length)} people · ${formatNumber(facets.email.valid)} valid · ${formatNumber(facets.email.not_found)} not found`}>
          <StatChip icon={Users} tone="brand" label="People" value={formatNumber(allPeople.length)} />
          <StatChip icon={MailCheck} tone="valid" label="Valid emails" value={`${formatNumber(facets.email.valid)}/${formatNumber(facets.email.has)}`} />
          <StatChip icon={MailX} tone={facets.email.not_found > 0 ? "invalid" : undefined} label="Not found" value={formatNumber(facets.email.not_found)} />
          <StatChip icon={MailQuestion} tone={facets.email.not_searched > 0 ? "risky" : undefined} label="Not searched" value={formatNumber(facets.email.not_searched)} />
          <StatChip icon={Mail} label="Emails" value={formatNumber(facets.email.has)} />
          <StatChip icon={Star} tone="violet" label="Founders" value={formatNumber(facets.seniority.founder ?? 0)} />
          <StatChip icon={Crown} label="C-Level" value={formatNumber(facets.seniority.c_level ?? 0)} />
          <StatChip icon={Users} label="VP / Pres" value={formatNumber((facets.seniority.vp ?? 0) + (facets.seniority.president ?? 0))} />
          <StatChip icon={Linkedin} tone="sky" label="LinkedIn" value={formatNumber(facets.linkedin.has)} />
          <StatChip icon={DollarSign} tone={facets.funded.has > 0 ? "valid" : undefined} label="Funded" value={formatNumber(facets.funded.has)} />
        </StatsBar>

        <div className="min-h-0 flex-1">
          {isLoading ? (
            <div className="space-y-2 p-4 sm:px-6">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
          ) : total === 0 ? (
            (filtersActive > 0 || debounced) ? (
              <EmptyState icon={Search} title="No people match your filters" description="Try removing some filters or the search." action={<Button variant="outline" onClick={() => { setFilters(EMPTY_PEOPLE_FILTERS); setSearch(""); }}><X /> Clear filters</Button>} className="m-6" />
            ) : (
              <EmptyState icon={Inbox} title="No people in this list" description="Add people from Find Leads." className="m-6" />
            )
          ) : (
            <>
            {/* Mobile: people cards */}
            <div className="scrollbar-thin h-full space-y-2 overflow-auto bg-background p-3 md:hidden">
              {rows.map((p) => {
                const id = dbIdOf(p);
                const selected = sel.rowChecked(id);
                return (
                  <div key={id} onClick={() => setDrawer(p)} className={cn("rounded-xl border border-border bg-card p-3 shadow-xs transition-colors active:bg-accent", selected && "border-brand/40 bg-brand/[0.05]")}>
                    <div className="flex items-start gap-2.5">
                      <div className="pt-0.5" onClick={(e) => e.stopPropagation()}><Check checked={selected} onChange={() => sel.toggleRow(id)} /></div>
                      <Avatar name={p.name || "?"} seed={p.id} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold leading-snug">{p.name || "—"}</p>
                        {p.title?.value && <p className="truncate text-xs text-muted-foreground">{p.title.value}</p>}
                      </div>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-[26px]">
                      <Pill tone={SENIORITY_TONE[p.seniority]} className="normal-case">{SENIORITY_LABEL[p.seniority]}</Pill>
                      {personHasFunding(p) && <FundedPill />}
                      {p.llmVerification && <LlmBadge v={p.llmVerification} />}
                    </div>
                    <div className="mt-2.5 space-y-2 border-t border-border pl-[26px] pt-2.5 text-xs">
                      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <CompanyLogo domain={p.companyDomain} text={p.companyLogoText || (p.company || "").slice(0, 2).toUpperCase()} className="size-5 shrink-0 text-[9px]" />
                        <span className="min-w-0 truncate font-medium text-foreground">{p.company || "—"}</span>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        {p.emailVerification ? (
                          isUnconfirmedEmail(p) ? <Pill tone="muted" className="normal-case">Not found</Pill>
                            : <div className="flex flex-wrap items-center gap-1.5"><span className="break-all font-medium">{String(p.email?.value ?? p.emailVerification.email)}</span><VerificationBadge ev={p.emailVerification} /></div>
                        ) : p.email ? (
                          <div className="flex flex-wrap items-center gap-1.5"><span className="break-all font-medium">{String(p.email.value)}</span><Pill tone="muted" className="normal-case">Not verified</Pill></div>
                        ) : null}
                      </div>
                      {(p.linkedin || p.location) && (
                        <div className="flex items-center gap-3 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                          {p.linkedin && <a href={linkHref(String(p.linkedin.value))} target="_blank" rel="noreferrer" className="inline-flex size-6 items-center justify-center rounded-md bg-surface transition-colors hover:text-brand" aria-label="LinkedIn"><Linkedin className="size-3.5" strokeWidth={1.75} /></a>}
                          {p.location && <span className="min-w-0 truncate">{p.location}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop: table */}
            <div className="scrollbar-thin hidden h-full overflow-auto bg-card md:block">
              <table className="w-full border-collapse text-[13px]">
                <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
                  <tr className="border-b border-border text-left text-[13px] font-normal text-muted-foreground">
                    <th className="w-10 py-3 pl-4 pr-2 sm:pl-6"><Check checked={sel.allMatching || sel.allPageSelected} indeterminate={sel.someSelected && !sel.allMatching && !sel.allPageSelected} onChange={sel.toggleHeader} /></th>
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
                    <th className="w-8 pr-4 sm:pr-6" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const id = dbIdOf(p);
                    const selected = sel.rowChecked(id);
                    return (
                      <tr key={id} onClick={() => setDrawer(p)} className={cn("group cursor-pointer border-b border-border transition-colors hover:bg-surface/60", selected && "bg-brand/[0.05] hover:bg-brand/[0.07]")}>
                        <td className="py-2.5 pl-4 pr-2 align-top sm:pl-6" onClick={(e) => e.stopPropagation()}><div className="pt-1.5"><Check checked={selected} onChange={() => sel.toggleRow(id)} /></div></td>
                        <td className="min-w-[160px] max-w-[240px] px-3 py-2.5 align-top">
                          <div className="flex min-w-0 items-start gap-2.5">
                            <Avatar name={p.name || "?"} seed={p.id} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate pt-0.5 font-semibold leading-snug text-foreground transition-colors group-hover:text-brand">{p.name || "—"}</p>
                              {(personHasFunding(p) || p.llmVerification) && (
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  {personHasFunding(p) && <FundedPill title={`Company funding: ${p.companyFunding}`} />}
                                  {p.llmVerification && <LlmBadge v={p.llmVerification} />}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        {show("title") && (
                          <td className="min-w-[200px] max-w-[420px] px-3 py-2.5 align-top text-muted-foreground">
                            {p.title?.value ? <span className="whitespace-normal break-words">{p.title.value}</span> : DASH}
                          </td>
                        )}
                        {show("email") && (
                          <td className="min-w-[220px] max-w-[360px] px-3 py-2.5 align-top" onClick={(e) => e.stopPropagation()}>
                            {p.emailVerification ? (
                              isUnconfirmedEmail(p) ? (
                                <Pill tone="muted" className="normal-case">Not found</Pill>
                              ) : (
                                <div className="flex flex-col items-start gap-1">
                                  <span className="break-all text-xs font-medium text-foreground">{String(p.email?.value ?? p.emailVerification.email)}</span>
                                  <VerificationBadge ev={p.emailVerification} />
                                </div>
                              )
                            ) : p.email ? (
                              <div className="flex flex-col items-start gap-1">
                                <span className="break-all text-xs font-medium text-foreground">{String(p.email.value)}</span>
                                <Pill tone="muted" className="normal-case">Not verified</Pill>
                              </div>
                            ) : DASH}
                          </td>
                        )}
                        {show("company") && (
                          <td className="min-w-[200px] max-w-[380px] px-3 py-2.5 align-top">
                            <div className="flex min-w-0 items-start gap-2">
                              <CompanyLogo domain={p.companyDomain} text={p.companyLogoText || (p.company || "").slice(0, 2).toUpperCase()} className="mt-0.5 size-6 text-[10px]" />
                              {p.company ? <span className="whitespace-normal break-words pt-0.5 font-medium text-foreground">{p.company}</span> : <span className="pt-0.5">{DASH}</span>}
                            </div>
                          </td>
                        )}
                        {show("companyEmployees") && (
                          <td className="whitespace-nowrap px-3 py-2.5 text-center align-top tabular-nums text-muted-foreground">{p.companyEmployees || DASH}</td>
                        )}
                        {show("companyIndustry") && (
                          <td className="min-w-[140px] max-w-[240px] px-3 py-2.5 align-top text-muted-foreground">
                            {p.companyIndustry ? <span className="whitespace-normal break-words">{p.companyIndustry}</span> : DASH}
                          </td>
                        )}
                        {show("seniority") && (
                          <td className="px-3 py-2.5 align-top"><Pill tone={SENIORITY_TONE[p.seniority]} className="normal-case">{SENIORITY_LABEL[p.seniority]}</Pill></td>
                        )}
                        {show("companyPhone") && (
                          <td className="whitespace-nowrap px-3 py-2.5 align-top tabular-nums text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                            {p.companyPhone ? <a href={`tel:${p.companyPhone}`} className="transition-colors hover:text-brand">{p.companyPhone}</a> : DASH}
                          </td>
                        )}
                        {show("companyEmail") && (
                          <td className="max-w-[220px] px-3 py-2.5 align-top text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                            {p.companyEmail ? <a href={`mailto:${p.companyEmail}`} className="line-clamp-1 transition-colors hover:text-brand">{p.companyEmail}</a> : DASH}
                          </td>
                        )}
                        {show("linkedin") && (
                          <td className="px-3 py-2.5 align-top" onClick={(e) => e.stopPropagation()}>
                            {p.linkedin ? (
                              <a href={linkHref(String(p.linkedin.value))} target="_blank" rel="noreferrer" className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-brand/10 hover:text-brand" aria-label="View LinkedIn"><Linkedin className="size-4" strokeWidth={1.75} /></a>
                            ) : DASH}
                          </td>
                        )}
                        {show("location") && (
                          <td className="whitespace-nowrap px-3 py-2.5 align-top text-muted-foreground">{p.location || DASH}</td>
                        )}
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
            <span><span className="font-semibold tabular-nums text-foreground">{formatNumber(total)}</span> people</span>
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
  return <SharedColumnsMenu defs={defs} cols={cols} onToggle={onToggle} onReset={onReset} />;
}

/* ------------------------- Company column config ------------------------- */

type CompanyColKey = "company" | "employees" | "industry" | "website" | "email" | "phone" | "linkedin" | "location" | "status";
const COMPANY_COLUMN_DEFS: { key: CompanyColKey; label: string; default: boolean }[] = [
  { key: "company", label: "Company", default: true },
  { key: "employees", label: "Employees", default: true },
  { key: "industry", label: "Industry", default: true },
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
  // Merge the server-side structured AI report (its own column) back onto the
  // snapshot so the detail drawer can render it. Falls back to any legacy copy
  // that older rows may have nested inside `data`.
  const allCompanies = React.useMemo(
    () => items.map((i) => {
      const c = i.data as unknown as CollectedCompany;
      return { ...c, aiReport: i.aiReport ?? c.aiReport ?? null };
    }),
    [items],
  );
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
    <div className="relative flex min-h-0 flex-1 overflow-clip">
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
          <span className="hidden shrink-0 items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-xs text-muted-foreground sm:inline-flex"><span className="font-semibold text-foreground tabular-nums">{formatNumber(total)}</span> companies</span>
          <div className="flex shrink-0 items-center gap-1.5 sm:ml-auto sm:gap-2">
            <ColumnsMenu defs={COMPANY_COLUMN_DEFS} cols={cols} onToggle={toggleCol} onReset={resetCols} />
            <Button size="sm" variant={showFilters ? "brand" : "outline"} className="h-9" onClick={() => openFiltersFor(setShowFilters, setMobileFilters)}>
              <SlidersHorizontal /> <span className="hidden sm:inline">Filters</span>{filtersActive > 0 && <span className="ml-0.5 rounded-md bg-brand/10 px-1.5 py-px text-[10px] font-semibold tabular-nums text-brand sm:ml-1">{filtersActive}</span>}
            </Button>
          </div>
        </div>


        {/* Stats — same rail as Find Leads (counts over the whole list) */}
        <StatsBar summary={`${formatNumber(allCompanies.length)} companies · ${formatNumber(facets.status.enriched ?? 0)} enriched`}>
          <StatChip icon={Building2} tone="brand" label="Companies" value={formatNumber(allCompanies.length)} />
          <StatChip icon={CheckCircle2} tone="valid" label="Enriched" value={formatNumber(facets.status.enriched ?? 0)} />
          <StatChip icon={XCircle} tone={(facets.status.failed ?? 0) + (facets.status.not_found ?? 0) > 0 ? "invalid" : undefined} label="Not found / failed" value={formatNumber((facets.status.failed ?? 0) + (facets.status.not_found ?? 0))} />
          <StatChip icon={Globe} tone="sky" label="Website" value={formatNumber(facets.has.website)} />
          <StatChip icon={MailCheck} tone="valid" label="Valid emails" value={`${formatNumber(facets.email.valid)}/${formatNumber(facets.has.email)}`} />
          <StatChip icon={Phone} label="Phone" value={formatNumber(facets.has.phone)} />
          <StatChip icon={Linkedin} tone="sky" label="LinkedIn" value={formatNumber(facets.has.linkedin)} />
        </StatsBar>

        <div className="min-h-0 flex-1">
          {isLoading ? (
            <div className="space-y-2 p-4 sm:px-6">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
          ) : total === 0 ? (
            (filtersActive > 0 || debounced) ? (
              <EmptyState icon={Search} title="No companies match your filters" description="Try removing some filters or the search." action={<Button variant="outline" onClick={() => { setFilters(EMPTY_COMPANY_FILTERS); setSearch(""); }}><X /> Clear filters</Button>} className="m-6" />
            ) : (
              <EmptyState icon={Inbox} title="No companies in this list" description="Add companies from Find Leads." className="m-6" />
            )
          ) : (
            <>
            {/* Mobile: company cards */}
            <div className="scrollbar-thin h-full space-y-2 overflow-auto bg-background p-3 md:hidden">
              {rows.map((c) => {
                const id = dbIdOf(c);
                const selected = sel.rowChecked(id);
                return (
                  <div key={id} onClick={() => setDrawer(c)} className={cn("rounded-xl border border-border bg-card p-3 shadow-xs transition-colors active:bg-accent", selected && "border-brand/40 bg-brand/[0.05]")}>
                    <div className="flex items-start gap-2.5">
                      <div className="pt-0.5" onClick={(e) => e.stopPropagation()}><Check checked={selected} onChange={() => sel.toggleRow(id)} /></div>
                      <CompanyLogo domain={c.domainGuess} text={c.logoText || (c.inputName || "").slice(0, 2).toUpperCase()} className="size-8 shrink-0 rounded-lg text-[11px]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold leading-snug">{c.inputName}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.inputLocation}{c.domainGuess ? ` · ${c.domainGuess}` : ""}</p>
                      </div>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    </div>
                    {(show("status") || c.llmVerification) && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-[26px]">
                        {show("status") && <StatusPill status={c.status} />}
                        {c.llmVerification && <LlmBadge v={c.llmVerification} />}
                      </div>
                    )}
                    <div className="mt-2.5 space-y-2 border-t border-border pl-[26px] pt-2.5 text-xs" onClick={(e) => e.stopPropagation()}>
                      {show("email") && (c.contactEmail?.value != null || c.emailVerification) && (
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">{c.contactEmail ? <span className="break-all font-medium"><Sourced field={c.contactEmail} /></span> : DASH}{c.emailVerification && <VerificationBadge ev={c.emailVerification} />}</div>
                      )}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                        {show("employees") && c.employees?.value != null && <span>Emp <Sourced field={c.employees} /></span>}
                        {show("industry") && c.industry?.value != null && <span className="min-w-0"><Sourced field={c.industry} /></span>}
                        {show("website") && c.website?.value != null && <span className="min-w-0"><Sourced field={c.website} /></span>}
                        {show("location") && (c.address?.value != null || c.inputLocation) && <span className="min-w-0">{c.address?.value ?? c.inputLocation}</span>}
                      </div>
                      {show("linkedin") && c.linkedin?.value != null && (
                        <a href={linkHref(String(c.linkedin.value))} target="_blank" rel="noreferrer" className="inline-flex size-6 items-center justify-center rounded-md bg-surface text-muted-foreground transition-colors hover:text-brand" aria-label="LinkedIn"><Linkedin className="size-3.5" strokeWidth={1.75} /></a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop: table */}
            <div className="scrollbar-thin hidden h-full overflow-auto bg-card md:block">
              <table className="w-full border-collapse text-[13px]">
                <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
                  <tr className="border-b border-border text-left text-[13px] font-normal text-muted-foreground">
                    <th className="w-10 py-3 pl-4 pr-2 sm:pl-6"><Check checked={sel.allMatching || sel.allPageSelected} indeterminate={sel.someSelected && !sel.allMatching && !sel.allPageSelected} onChange={sel.toggleHeader} /></th>
                    {show("company") && <th className="whitespace-nowrap px-3 py-3"><ColHead label="Company" /></th>}
                    {show("employees") && <th className="whitespace-nowrap px-3 py-3 text-center"><ColHead label="Employees" align="center" /></th>}
                    {show("industry") && <th className="whitespace-nowrap px-3 py-3"><ColHead label="Industry" /></th>}
                    {show("website") && <th className="whitespace-nowrap px-3 py-3"><ColHead label="Website" /></th>}
                    {show("email") && <th className="whitespace-nowrap px-3 py-3"><ColHead label="Email" /></th>}
                    {show("phone") && <th className="whitespace-nowrap px-3 py-3"><ColHead label="Phone" /></th>}
                    {show("linkedin") && <th className="whitespace-nowrap px-3 py-3"><ColHead label="LinkedIn" /></th>}
                    {show("location") && <th className="whitespace-nowrap px-3 py-3"><ColHead label="Location" /></th>}
                    {show("status") && <th className="whitespace-nowrap px-3 py-3"><ColHead label="Status" /></th>}
                    <th className="w-8 pr-4 sm:pr-6" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const id = dbIdOf(c);
                    const selected = sel.rowChecked(id);
                    return (
                      <tr key={id} onClick={() => setDrawer(c)} className={cn("group cursor-pointer border-b border-border transition-colors hover:bg-surface/60", selected && "bg-brand/[0.05] hover:bg-brand/[0.07]")}>
                        <td className="py-2.5 pl-4 pr-2 align-top sm:pl-6" onClick={(e) => e.stopPropagation()}><div className="pt-1.5"><Check checked={selected} onChange={() => sel.toggleRow(id)} /></div></td>
                        {show("company") && (
                          <td className="min-w-[200px] max-w-[300px] px-3 py-2.5 align-top">
                            <div className="flex min-w-0 items-start gap-2.5">
                              <CompanyLogo domain={c.domainGuess} text={c.logoText || (c.inputName || "").slice(0, 2).toUpperCase()} className="size-8 rounded-lg text-[11px]" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate pt-0.5 font-semibold leading-snug text-foreground transition-colors group-hover:text-brand">{c.inputName}</p>
                                <p className="truncate text-xs text-muted-foreground">{c.inputLocation}{c.domainGuess ? ` · ${c.domainGuess}` : ""}{c.resolution && c.resolution.confidence > 0 ? ` · ${c.resolution.confidence}% match` : ""}</p>
                                {c.llmVerification && (
                                  <div className="mt-1 flex flex-wrap items-center gap-1"><LlmBadge v={c.llmVerification} /></div>
                                )}
                              </div>
                            </div>
                          </td>
                        )}
                        {show("employees") && <td className="whitespace-nowrap px-3 py-2.5 text-center align-top tabular-nums text-muted-foreground">{c.employees ? <Sourced field={c.employees} showConfidence /> : DASH}</td>}
                        {show("industry") && <td className="min-w-[140px] max-w-[240px] px-3 py-2.5 align-top text-muted-foreground">{c.industry ? <span className="whitespace-normal break-words"><Sourced field={c.industry} /></span> : DASH}</td>}
                        {show("website") && <td className="max-w-[220px] px-3 py-2.5 align-top text-muted-foreground" onClick={(e) => e.stopPropagation()}>{c.website ? <span className="line-clamp-1"><Sourced field={c.website} /></span> : DASH}</td>}
                        {show("email") && (
                          <td className="min-w-[220px] max-w-[360px] px-3 py-2.5 align-top" onClick={(e) => e.stopPropagation()}>
                            {c.contactEmail || c.emailVerification ? (
                              <div className="flex flex-col items-start gap-1">
                                {c.contactEmail ? <span className="break-all text-xs font-medium text-foreground"><Sourced field={c.contactEmail} /></span> : DASH}
                                {c.emailVerification && <VerificationBadge ev={c.emailVerification} />}
                              </div>
                            ) : DASH}
                          </td>
                        )}
                        {show("phone") && <td className="whitespace-nowrap px-3 py-2.5 align-top tabular-nums text-muted-foreground" onClick={(e) => e.stopPropagation()}>{c.phone ? <Sourced field={c.phone} /> : DASH}</td>}
                        {show("linkedin") && (
                          <td className="px-3 py-2.5 align-top" onClick={(e) => e.stopPropagation()}>
                            {c.linkedin?.value ? (
                              <a href={linkHref(String(c.linkedin.value))} target="_blank" rel="noreferrer" className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-brand/10 hover:text-brand" aria-label="View LinkedIn"><Linkedin className="size-4" strokeWidth={1.75} /></a>
                            ) : DASH}
                          </td>
                        )}
                        {show("location") && (
                          <td className="min-w-[140px] max-w-[260px] px-3 py-2.5 align-top text-muted-foreground">
                            {c.address ? <span className="whitespace-normal break-words"><Sourced field={c.address} /></span> : c.inputLocation ? <span className="whitespace-normal break-words">{c.inputLocation}</span> : DASH}
                          </td>
                        )}
                        {show("status") && <td className="px-3 py-2.5 align-top"><StatusPill status={c.status} /></td>}
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
            <Pagination page={page} totalPages={totalPages} setPage={setPage} />
          </div>
        )}

        {sel.someSelected && <BulkBar effectiveCount={sel.effectiveCount} total={total} selectedSize={sel.selectedIds.size} allMatching={sel.allMatching} onSelectAll={sel.selectAll} onExport={onExport} onRemove={sel.remove} onClear={sel.clearSelection} busy={sel.busy} />}
        <CompanyCollectDrawer company={drawer} open={!!drawer} onOpenChange={(o) => !o && setDrawer(null)} />
      </div>
    </div>
  );
}

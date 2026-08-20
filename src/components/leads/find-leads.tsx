"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PanelLeftClose, PanelLeft, Save } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LeadsTabs } from "./leads-tabs";
import { StatCards } from "./stat-cards";
import { SearchBar } from "./search-bar";
import { SearchSettings, type ColumnOption } from "./search-settings";
import { ResearchAIMenu, CreateWorkflowMenu, DefaultViewMenu, RelevanceMenu } from "./toolbar-menus";
import { PeopleFilterSidebar } from "./people-filter-sidebar";
import { PeopleTable, type PeopleAction } from "./people-table";
import { LeadDetailDrawer } from "./lead-detail-drawer";
import { BulkActionBar, type BulkAction } from "./bulk-action-bar";
import { CompaniesTab } from "./companies-tab";
import { JobsTab } from "./jobs-tab";
import { queryPeople, PEOPLE_STATS, COMPANY_STATS, JOB_STATS, allPeople } from "@/lib/leads/data";
import {
  DEFAULT_PEOPLE_FILTERS, type LeadsTab, type Person, type PeopleFilters, type SortState,
} from "@/lib/leads/types";

const PEOPLE_COLUMNS: ColumnOption[] = [
  { key: "name", label: "Name" }, { key: "jobTitle", label: "Job Title" }, { key: "company", label: "Company" },
  { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "location", label: "Location" },
  { key: "linkedin", label: "LinkedIn" },
];
const DEFAULT_VISIBLE = ["name", "jobTitle", "company", "email", "phone", "location"];

/** Count of non-default (active) People filters, for the sidebar badge. */
function countActive(f: PeopleFilters): number {
  let n = 0;
  n += f.emailStatus.length + f.jobTitles.length + f.excludedCompanies.length;
  n += f.seniority.length + f.departments.length + f.companySize.length + f.industries.length + f.technologies.length;
  if (f.country !== "all") n++;
  if (f.emailAvailable) n++;
  if (f.linkedinAvailable) n++;
  return n;
}

const TAB_TITLE: Record<LeadsTab, string> = { people: "Find people", companies: "Find companies", jobs: "Find jobs" };

/** People filters minus the free-text search (search is serialised separately as `q`). */
function filtersWithoutSearch(f: PeopleFilters): Omit<PeopleFilters, "search"> {
  const copy: Partial<PeopleFilters> = { ...f };
  delete copy.search;
  return copy as Omit<PeopleFilters, "search">;
}

export function FindLeads() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const searchRef = React.useRef<HTMLInputElement>(null);

  /* ------------------------------ URL-backed state ------------------------------ */
  const [tab, setTab] = React.useState<LeadsTab>(() => (searchParams.get("tab") as LeadsTab) || "people");
  const [filters, setFilters] = React.useState<PeopleFilters>(() => {
    const raw = searchParams.get("pf");
    const q = searchParams.get("q") ?? "";
    let parsed: Partial<PeopleFilters> = {};
    if (raw) { try { parsed = JSON.parse(decodeURIComponent(raw)); } catch { /* ignore */ } }
    return { ...DEFAULT_PEOPLE_FILTERS, ...parsed, search: q || parsed.search || "" };
  });

  const [filtersVisible, setFiltersVisible] = React.useState(true);
  const [sort, setSort] = React.useState<SortState | null>(null);
  const [relevance, setRelevance] = React.useState("relevance");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [visible, setVisible] = React.useState<Set<string>>(() => new Set(DEFAULT_VISIBLE));
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [drawerPerson, setDrawerPerson] = React.useState<Person | null>(null);

  // Persist tab + search + filters to the URL (shareable, restores on reload).
  React.useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== "people") params.set("tab", tab);
    if (filters.search) params.set("q", filters.search);
    const rest = filtersWithoutSearch(filters);
    if (JSON.stringify(rest) !== JSON.stringify(filtersWithoutSearch(DEFAULT_PEOPLE_FILTERS))) {
      params.set("pf", encodeURIComponent(JSON.stringify(rest)));
    }
    const qs = params.toString();
    router.replace(qs ? `/find-leads?${qs}` : "/find-leads", { scroll: false });
  }, [tab, filters, router]);

  // Reset page when the query changes.
  React.useEffect(() => { setPage(1); }, [filters, sort, pageSize]);

  /* ------------------------------ keyboard shortcuts ------------------------------ */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Some events (IME composition, autofill, native <select> interaction) fire
      // keydown with an undefined `key` — guard before comparing.
      const key = e.key;
      if (!key) return;
      if (key === "Escape") { if (selected.size) setSelected(new Set()); return; }
      const el = e.target as HTMLElement | null;
      const typing = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.tagName === "SELECT" || el?.isContentEditable === true;
      if (typing) return;
      if (key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      else if (key.toLowerCase() === "f") { setFiltersVisible((v) => !v); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected.size]);

  /* ------------------------------ data ------------------------------ */
  const result = React.useMemo(
    () => queryPeople(filters, sort, page, pageSize),
    [filters, sort, page, pageSize],
  );
  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));
  const pageIds = result.rows.map((r) => r.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const savedCount = allPeople().filter((p) => p.saved).length;

  const patch = (p: Partial<PeopleFilters>) => setFilters((f) => ({ ...f, ...p }));
  const clearFilters = () => setFilters({ ...DEFAULT_PEOPLE_FILTERS, search: filters.search });

  const onSort = (key: string) => {
    setRelevance("");
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  };
  const onRelevance = (value: string) => {
    setRelevance(value);
    setSort(value === "relevance" ? null : { key: value === "icpScore" ? "icpScore" : value, dir: value === "icpScore" ? "desc" : "asc" });
  };

  const toggleRow = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAllPage = () => setSelected((s) => {
    const n = new Set(s);
    if (allPageSelected) pageIds.forEach((id) => n.delete(id));
    else pageIds.forEach((id) => n.add(id));
    return n;
  });

  const ACTION_LABEL: Record<PeopleAction, string> = {
    save: "Saved lead", add_list: "Added to list", find_email: "Email revealed", verify_email: "Email verified",
    find_phone: "Mobile revealed", view_linkedin: "Opening LinkedIn", view_company: "Opening company", add_workflow: "Added to workflow",
  };
  const onAction = (action: PeopleAction, p: Person) =>
    toast({ variant: action === "verify_email" || action === "save" ? "success" : "info", title: ACTION_LABEL[action], description: p.name });

  const onBulk = (action: BulkAction) => {
    const labels: Record<BulkAction, string> = {
      save: "Saved", add_list: "Added to list", verify_emails: "Verifying emails", find_emails: "Finding emails", add_workflow: "Added to workflow", export: "Exporting",
    };
    toast({ variant: "success", title: `${labels[action]} — ${formatNumber(selected.size)} leads` });
    if (action === "export") return;
  };

  const stats = tab === "people"
    ? [{ label: "Total", value: PEOPLE_STATS.total }, { label: "Net New", value: PEOPLE_STATS.netNew }, { label: "Saved", value: formatNumber(savedCount) }]
    : tab === "companies"
      ? [{ label: "Total", value: COMPANY_STATS.total }, { label: "Net New", value: COMPANY_STATS.netNew }, { label: "Saved", value: "3.7K" }]
      : [{ label: "Total Jobs", value: JOB_STATS.total }, { label: "New Jobs", value: JOB_STATS.netNew }, { label: "Saved", value: "2.1K" }];

  const activeCount = countActive(filters);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="space-y-3 border-b px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Find Leads</span>
            <LeadsTabs active={tab} onChange={(t) => { setTab(t); setSelected(new Set()); }} />
          </div>
          <div className="w-full max-w-md sm:w-auto"><StatCards items={stats} /></div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight">{TAB_TITLE[tab]}</h1>
            <DefaultViewMenu onSelect={(l) => toast({ variant: "info", title: l })} />
            <Button variant="outline" size="sm" className="h-9" onClick={() => setFiltersVisible((v) => !v)}>
              {filtersVisible ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />}
              {filtersVisible ? "Hide Filters" : "Show Filters"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ResearchAIMenu onSelect={(l) => toast({ variant: "info", title: "Research with AI", description: l })} />
            <CreateWorkflowMenu onSelect={(l) => toast({ variant: "info", title: "Workflow", description: l })} />
            <Button variant="outline" size="sm" className="h-9" onClick={() => toast({ variant: "success", title: "Search saved", description: "Saved to your searches." })}>
              <Save className="size-4" /> Save as new search
            </Button>
            <RelevanceMenu current={relevance} onSelect={onRelevance} />
            <SearchSettings
              columns={PEOPLE_COLUMNS}
              visible={visible}
              onToggleColumn={(k) => setVisible((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })}
              pageSize={pageSize}
              onPageSize={setPageSize}
            />
          </div>
        </div>

        <SearchBar
          value={filters.search}
          onChange={(v) => patch({ search: v })}
          onApplyParsed={tab === "people" ? (p) => { patch(p); toast({ variant: "success", title: "Filters applied from search" }); } : undefined}
          placeholder={`Search ${tab}, or try “CTOs at fintech companies in Australia, 50-200 employees”`}
          inputRef={searchRef}
        />
      </div>

      {/* Body */}
      {tab === "people" ? (
        <div className="flex min-h-0 flex-1">
          {filtersVisible && (
            <aside className="hidden w-[280px] shrink-0 overflow-hidden border-r bg-muted/20 md:block">
              <PeopleFilterSidebar filters={filters} onChange={patch} activeCount={activeCount} onClear={clearFilters} />
            </aside>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Results header */}
            <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
              <span className="text-muted-foreground">
                <span className="font-semibold text-foreground tabular-nums">{formatNumber(result.total)}</span> results
                {selected.size > 0 && <> · <span className="font-medium text-primary">{formatNumber(selected.size)} selected</span></>}
              </span>
              <Pagination page={page} totalPages={totalPages} onPage={setPage} />
            </div>

            {/* Table */}
            <div className="min-h-0 flex-1">
              {result.total === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <p className="text-base font-semibold">No people match your filters</p>
                  <p className="text-sm text-muted-foreground">Try widening a filter or clearing the search.</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={clearFilters}>Clear filters</Button>
                </div>
              ) : (
                <PeopleTable
                  rows={result.rows}
                  visibleColumns={visible}
                  sort={sort}
                  onSort={onSort}
                  selectedIds={selected}
                  onToggleRow={toggleRow}
                  onToggleAllPage={toggleAllPage}
                  allPageSelected={allPageSelected}
                  onOpenPerson={setDrawerPerson}
                  onAction={onAction}
                />
              )}
            </div>
          </div>
        </div>
      ) : tab === "companies" ? (
        <CompaniesTab />
      ) : (
        <JobsTab filtersVisible={filtersVisible} search={filters.search} />
      )}

      <BulkActionBar count={selected.size} onAction={onBulk} onClear={() => setSelected(new Set())} />
      <LeadDetailDrawer person={drawerPerson} open={!!drawerPerson} onOpenChange={(o) => !o && setDrawerPerson(null)} onAction={onAction} />
    </div>
  );
}

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" className="h-8" disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))}>Previous</Button>
      <span className="text-xs tabular-nums text-muted-foreground">Page {page} / {totalPages}</span>
      <Button size="sm" variant="outline" className="h-8" disabled={page >= totalPages} onClick={() => onPage(Math.min(totalPages, page + 1))}>Next</Button>
    </div>
  );
}


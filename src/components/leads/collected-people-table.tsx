"use client";
import { ColHead } from "@/components/common/col-head";
import { ColumnsMenu as SharedColumnsMenu } from "./columns-menu";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Inbox, Loader2, ChevronRight, Linkedin, ChevronDown, ListPlus, Download, X, Plus, SlidersHorizontal, MailCheck, DollarSign, Columns3, ArrowUp, ArrowDown, ArrowUpDown, Sparkles, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox as Check, CheckboxIndicator } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { getCollectedPeople, verifyPersonEmail, getLeadLists, createLeadList, addPeopleToList, aiTagPeople, ApiError, type AiTagColor, type PeopleAddSelection } from "@/lib/api/client";
import { formatNumber, cn } from "@/lib/utils";
import { addToListToast } from "@/lib/leads/lead-snapshot";
import { toCsv, downloadCsv } from "@/lib/leads/csv";
import { peopleExportTable } from "@/lib/leads/people-export";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { TONES, IconTile, Field, Pill, type Tone } from "@/components/common/kit";
import { Avatar } from "./leads-ui";
import { CompanyLogo, VerificationBadge, LlmBadge } from "./collect-ui";
import { PeopleFilterPanel } from "./people-filter-panel";
import { MobileFilterDrawer, openFiltersFor } from "./filter-drawer";
import { SENIORITY_LABEL, EMPTY_PEOPLE_FILTERS, countPeopleFilters, isUnconfirmedEmail, personHasFunding, type PeopleFilters, type CollectedPerson, type PersonSeniority } from "@/lib/leads/people-types";

const PAGE_SIZE = 25;

/**
 * Customizable table columns. Order here is the on-screen order (after the fixed
 * Name column): Email / Company / Company employees / Company industry sit right
 * after Title; Seniority is hidden by default. The user toggles columns via the
 * "Columns" menu and the choice persists in localStorage.
 */
type ColKey =
  | "title" | "email" | "company" | "companyEmployees" | "companyIndustry"
  | "seniority" | "companyPhone" | "companyEmail" | "linkedin" | "location";

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
const COL_STORAGE_KEY = "people-table-columns-v1";

function loadCols(): Record<ColKey, boolean> {
  const base = { ...DEFAULT_COLS };
  try {
    const raw = localStorage.getItem(COL_STORAGE_KEY);
    if (raw) { const saved = JSON.parse(raw) as Partial<Record<ColKey, boolean>>; for (const c of COLUMN_DEFS) if (typeof saved[c.key] === "boolean") base[c.key] = saved[c.key]!; }
  } catch { /* ignore unreadable storage */ }
  return base;
}

const SENIORITY_TONE: Record<PersonSeniority, Tone> = {
  founder: "valid",
  c_level: "brand",
  president: "violet",
  vp: "risky",
  other: "muted",
};

// AI Support tags — colour → pill + row-accent classes. Status tokens where a
// semantic one exists, otherwise theme-aware hsl tints (same recipe as the kit's
// violet/sky tones), so every tag reads in both light and dark.
const TAG_STYLES: Record<AiTagColor, { pill: string; row: string }> = {
  amber:  { pill: TONES.risky,   row: "border-l-2 border-l-[hsl(var(--risky))]" },
  blue:   { pill: TONES.sky,     row: "border-l-2 border-l-[hsl(199_89%_48%)]" },
  green:  { pill: TONES.valid,   row: "border-l-2 border-l-[hsl(var(--valid))]" },
  purple: { pill: TONES.violet,  row: "border-l-2 border-l-[hsl(280_70%_60%)]" },
  red:    { pill: TONES.invalid, row: "border-l-2 border-l-[hsl(var(--invalid))]" },
  teal:   { pill: "bg-[hsl(173_70%_40%/0.12)] text-[hsl(173_75%_30%)] dark:text-[hsl(173_65%_60%)]", row: "border-l-2 border-l-[hsl(173_70%_40%)]" },
  pink:   { pill: "bg-[hsl(330_80%_60%/0.12)] text-[hsl(330_70%_48%)] dark:text-[hsl(330_85%_75%)]", row: "border-l-2 border-l-[hsl(330_80%_60%)]" },
  orange: { pill: "bg-[hsl(25_95%_53%/0.12)] text-[hsl(22_85%_42%)] dark:text-[hsl(25_95%_68%)]",   row: "border-l-2 border-l-[hsl(25_95%_53%)]" },
};

type AiTag = { id: string; label: string; color: AiTagColor; ids: Set<string> };

const linkedinHref = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://${v}`);

export function CollectedPeopleTable({
  jobId,
  jobName,
  sourceColumns,
  live,
  bulkVerifying = false,
  verifyingPersonIds: jobVerifyingIds,
  onOpenPerson,
}: {
  jobId: string;
  jobName?: string;
  /** Imported CSV header — the export reproduces these columns. */
  sourceColumns?: string[];
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
  // Column visibility (default on first render for SSR safety, then hydrated from
  // localStorage on mount so the saved layout wins without a hydration mismatch).
  const [cols, setCols] = React.useState<Record<ColKey, boolean>>(DEFAULT_COLS);
  React.useEffect(() => { setCols(loadCols()); }, []);
  const toggleCol = (key: ColKey) => setCols((prev) => { const next = { ...prev, [key]: !prev[key] }; try { localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ } return next; });
  const resetCols = () => { setCols(DEFAULT_COLS); try { localStorage.removeItem(COL_STORAGE_KEY); } catch { /* ignore */ } };
  const show = (key: ColKey) => cols[key];
  // Sort by any column, applied server-side across all pages. Clicking a column
  // cycles asc → desc → off; clicking another column starts it at asc.
  const [sortField, setSortField] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");
  const sort = sortField ? (sortDir === "asc" ? sortField : `${sortField}_desc`) : undefined;
  const onSort = (field: string) => {
    if (sortField !== field) { setSortField(field); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortField(null); setSortDir("asc"); }
  };
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);
  const filterKey = JSON.stringify(filters);
  React.useEffect(() => { setPage(1); }, [debounced, filterKey, sortField, sortDir]);

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = React.useState(false);
  // When set, the table is filtered to just this AI tag's rows (server-side id whitelist).
  const [activeTagId, setActiveTagId] = React.useState<string | null>(null);
  React.useEffect(() => { setSelectedIds(new Set()); setAllMatching(false); }, [jobId, debounced, filterKey, activeTagId]);

  // AI Support: run a natural-language instruction over the rows; matched people
  // get an ephemeral coloured tag (highlight). Tags are client-only and reset when
  // the job changes.
  const [aiTags, setAiTags] = React.useState<AiTag[]>([]);
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiPrompt, setAiPrompt] = React.useState("");
  const [aiBusy, setAiBusy] = React.useState(false);
  React.useEffect(() => { setAiTags([]); setAiOpen(false); setAiPrompt(""); setActiveTagId(null); }, [jobId]);
  // Drop the filter if its tag was removed.
  React.useEffect(() => { if (activeTagId && !aiTags.some((t) => t.id === activeTagId)) setActiveTagId(null); }, [aiTags, activeTagId]);
  const tagsForRow = React.useCallback((id: string) => aiTags.filter((t) => t.ids.has(id)), [aiTags]);
  const activeTag = activeTagId ? aiTags.find((t) => t.id === activeTagId) ?? null : null;
  const tagFilterIds = React.useMemo(() => (activeTag ? [...activeTag.ids] : undefined), [activeTag]);
  React.useEffect(() => { setPage(1); }, [activeTagId]);

  const runAiTag = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt || aiBusy) return;
    setAiBusy(true);
    try {
      const r = await aiTagPeople(jobId, prompt, debounced);
      if (!r.tag || r.matchedIds.length === 0) {
        toast({ variant: "info", title: "No matches", description: `Nothing matched “${prompt}” in ${formatNumber(r.scanned)} scanned.` });
      } else {
        setAiTags((prev) => [...prev, { id: `t${Date.now()}`, label: r.tag!.label, color: r.tag!.color, ids: new Set(r.matchedIds) }]);
        const more = r.total > r.scanned ? ` · scanned first ${formatNumber(r.scanned)} of ${formatNumber(r.total)}` : "";
        toast({ variant: "success", title: `Tagged ${formatNumber(r.matchedIds.length)} · “${r.tag.label}”`, description: `${formatNumber(r.tokens)} tokens${more}` });
        setAiPrompt(""); setAiOpen(false);
      }
    } catch (e) {
      toast({ variant: "error", title: "AI Support failed", description: e instanceof ApiError && e.code === "LLM_NOT_CONFIGURED" ? "Set DEEPSEEK_API_KEY in the app env." : "Try again." });
    } finally { setAiBusy(false); }
  };

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["collect-people", jobId, debounced, filterKey, sort ?? "", page, activeTagId ?? ""],
    queryFn: () => getCollectedPeople(jobId, { search: debounced, ...filters, ids: tagFilterIds, sort, page, pageSize: PAGE_SIZE }),
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

  const [busy, setBusy] = React.useState<null | "export" | "list">(null);

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
      // Same columns as the imported CSV (or the full Apollo layout), current values.
      const { headers, rows } = peopleExportTable(sel, sourceColumns);
      const csv = toCsv(headers, rows);
      downloadCsv(jobName?.trim() || `people-${jobId}`, csv);
      const withValid = sel.filter((p) => p.emailVerification?.status === "valid").length;
      toast({
        variant: "success",
        title: `Exported ${formatNumber(sel.length)} ${sel.length === 1 ? "person" : "people"}`,
        description: withValid < sel.length ? `${formatNumber(withValid)} with a verified-valid email` : undefined,
      });
    } catch { toast({ variant: "error", title: "Export failed" }); }
    finally { setBusy(null); }
  };

  // Add-to-list sends only the SELECTION (explicit ids, or "all" + the visible
  // filter context) — never the row snapshots — so a huge Select-all can't 413 at
  // a proxy. The server resolves the rows and forwards them in chunks.
  const buildAddSelection = (): PeopleAddSelection =>
    allMatching
      ? { all: true, query: { search: debounced, ...filters, ids: tagFilterIds, sort } }
      : { all: false, personIds: [...selectedIds] };

  const addSelectedToList = async (listId: string, listName: string) => {
    if (!someSelected) { toast({ variant: "info", title: "Nothing selected" }); return; }
    setBusy("list");
    try {
      const { added, skipped, count } = await addPeopleToList(jobId, listId, buildAddSelection());
      if (count === 0) { toast({ variant: "info", title: "Nothing selected" }); return; }
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
      toast(addToListToast(added, skipped, listName));
    }
    catch { toast({ variant: "error", title: "Could not add to list" }); } finally { setBusy(null); }
  };

  // "New list" opens a naming dialog (same as /lists), then adds the selection.
  const [newListOpen, setNewListOpen] = React.useState(false);
  const [newListName, setNewListName] = React.useState("");
  const createAndAdd = async () => {
    const name = newListName.trim();
    if (!name) return;
    if (!someSelected) { toast({ variant: "info", title: "Nothing selected" }); setNewListOpen(false); return; }
    setBusy("list");
    try {
      const list = await createLeadList(name);
      const { added, skipped, count } = await addPeopleToList(jobId, list.id, buildAddSelection());
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
      setNewListOpen(false); setNewListName("");
      if (count === 0) { toast({ variant: "info", title: "Nothing selected" }); return; }
      toast(addToListToast(added, skipped, list.name));
    }
    catch { toast({ variant: "error", title: "Could not create list" }); } finally { setBusy(null); }
  };

  const { data: lists = [] } = useQuery({ queryKey: ["lead-lists"], queryFn: getLeadLists });

  return (
    <div className="flex min-h-0 flex-1">
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
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, title or company…" type="search" autoComplete="off" data-1p-ignore data-lpignore="true" className="h-9 pl-9" />
        </div>
        <span className="hidden items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-xs text-muted-foreground sm:inline-flex"><span className="font-semibold text-foreground tabular-nums">{formatNumber(total)}</span> people</span>
        <div className="flex shrink-0 items-center gap-1.5 sm:ml-auto sm:gap-2">
          <div className="relative">
            <Button size="sm" variant={aiOpen || aiTags.length > 0 ? "brand" : "outline"} className="h-9" onClick={() => setAiOpen((o) => !o)} title="Ask AI to tag rows by a natural-language instruction.">
              <Sparkles /> <span className="hidden sm:inline">AI Support</span>{aiTags.length > 0 && <span className="ml-0.5 rounded-md bg-brand/10 px-1.5 text-[10px] font-semibold tabular-nums text-brand sm:ml-1">{aiTags.length}</span>}
            </Button>
            {aiOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setAiOpen(false)} />
                <div className="fixed inset-x-4 z-30 mt-1.5 animate-fade-in overflow-hidden rounded-xl border border-border bg-card shadow-pop sm:absolute sm:inset-x-auto sm:right-0 sm:w-[23rem] sm:max-w-[calc(100vw-2rem)]">
                  <div className="flex items-start gap-3 border-b border-border px-4 py-3">
                    <IconTile icon={Sparkles} tone="brand" size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-snug">AI Support</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">Describe what to tag. The AI highlights matching people in the table.</p>
                    </div>
                  </div>
                  <div className="p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      autoFocus
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runAiTag(); } }}
                      placeholder="e.g. Highlight Indian names"
                      className="h-9"
                      disabled={aiBusy}
                    />
                    <Button size="sm" className="h-9 shrink-0" onClick={runAiTag} disabled={aiBusy || !aiPrompt.trim()}>
                      {aiBusy ? <Loader2 className="animate-spin" /> : <Sparkles />}
                      {aiBusy ? "Running…" : "Run"}
                    </Button>
                  </div>
                  <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Try</p>
                  <div className="flex flex-wrap gap-1.5">
                    {["Highlight Indian names", "Tag founders & CEOs", "Mark fintech companies", "Flag people with no email"].map((ex) => (
                      <button key={ex} onClick={() => setAiPrompt(ex)} disabled={aiBusy} className="rounded-md border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-50">{ex}</button>
                    ))}
                  </div>
                  </div>
                </div>
              </>
            )}
          </div>
          <ColumnsMenu cols={cols} onToggle={toggleCol} onReset={resetCols} />
          <Button size="sm" variant={showFilters ? "brand" : "outline"} className="h-9" onClick={() => openFiltersFor(setShowFilters, setMobileFilters)}>
            <SlidersHorizontal /> <span className="hidden sm:inline">Filters</span>{filtersActive > 0 && <span className="ml-0.5 rounded-md bg-brand/10 px-1.5 text-[10px] font-semibold tabular-nums text-brand sm:ml-1">{filtersActive}</span>}
          </Button>
        </div>
      </div>

      {aiTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface px-4 py-2 text-xs sm:px-6">
          <span className="mr-0.5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><Sparkles className="size-3.5 text-brand" strokeWidth={1.75} /> AI tags</span>
          {aiTags.map((t) => {
            const on = activeTagId === t.id;
            return (
              <span key={t.id} className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold", TAG_STYLES[t.color].pill, on && "ring-1 ring-inset ring-current")}>
                <button
                  onClick={() => setActiveTagId((cur) => (cur === t.id ? null : t.id))}
                  title={on ? "Showing only these rows. Click to show all" : "Filter the table to rows with this tag"}
                  className="inline-flex cursor-pointer items-center gap-1"
                >
                  {on && <Filter className="size-3" />}{t.label} · {formatNumber(t.ids.size)}
                </button>
                <button onClick={() => setAiTags((p) => p.filter((x) => x.id !== t.id))} className="hover:opacity-70" aria-label={`Remove tag ${t.label}`}><X className="size-3" /></button>
              </span>
            );
          })}
          {activeTagId
            ? <button onClick={() => setActiveTagId(null)} className="ml-1 font-medium text-brand hover:underline">Show all</button>
            : <span className="ml-1 text-muted-foreground">· click a tag to filter</span>}
          <button onClick={() => { setAiTags([]); setActiveTagId(null); }} className="ml-auto text-muted-foreground hover:text-foreground">Clear all</button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2 p-4 sm:px-6">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
        ) : total === 0 ? (
          filtersActive > 0 || debounced ? (
            <EmptyState
              icon={Search}
              title="No people match your filters"
              description="No one matches the current filters and search. Try removing some to see more."
              action={<Button variant="outline" onClick={() => { setFilters(EMPTY_PEOPLE_FILTERS); setSearch(""); }}><X /> Clear filters</Button>}
              className="m-6"
            />
          ) : (
            <EmptyState icon={Inbox} title="No people found yet" description="People appear here as each company is crawled." className="m-6" />
          )
        ) : (
          <>
          {/* Mobile: people cards */}
          <div className={cn("scrollbar-thin h-full space-y-2 overflow-auto bg-background p-3 transition-opacity md:hidden", isPlaceholderData && "opacity-60")}>
            {rows.map((p) => {
              const selected = rowChecked(p.id);
              const finding = inflightIds.has(p.id);
              const rowTags = tagsForRow(p.id);
              return (
                <div key={p.id} onClick={() => onOpenPerson(p)} className={cn("rounded-xl border border-border bg-card p-3 shadow-xs transition-colors active:bg-accent", rowTags[0] && TAG_STYLES[rowTags[0].color].row, selected && "border-brand/40 bg-brand/[0.05]")}>
                  <div className="flex items-start gap-2.5">
                    <div className="pt-0.5" onClick={(e) => e.stopPropagation()}><Check checked={selected} onChange={() => toggleRow(p.id)} /></div>
                    <Avatar name={p.name} seed={p.id} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold leading-snug">{p.name}</p>
                      {p.title?.value && <p className="truncate text-xs text-muted-foreground">{p.title.value}</p>}
                      {p.altName && p.altName !== p.name && (
                        <p className="truncate text-[11px] text-muted-foreground">Also: <span className="font-medium text-foreground/80">{p.altName}</span></p>
                      )}
                    </div>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-[26px]">
                    <Pill tone={SENIORITY_TONE[p.seniority]} className="normal-case">{SENIORITY_LABEL[p.seniority]}</Pill>
                    {personHasFunding(p) && <Pill tone="valid"><DollarSign className="size-3" /> Funded</Pill>}
                    {p.llmVerification && <LlmBadge v={p.llmVerification} />}
                    {rowTags.map((t) => <span key={t.id} className={cn("inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold", TAG_STYLES[t.color].pill)}>{t.label}</span>)}
                  </div>
                  <div className="mt-2.5 space-y-2 border-t border-border pl-[26px] pt-2.5 text-xs">
                    <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                      <CompanyLogo domain={p.companyDomain} text={p.companyLogoText} className="size-5 shrink-0 text-[9px]" />
                      <span className="min-w-0 truncate font-medium text-foreground">{p.company}</span>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      {p.emailVerification ? (
                        isUnconfirmedEmail(p) ? <Pill tone="muted" className="normal-case">Not found</Pill>
                          : <div className="flex flex-wrap items-center gap-1.5"><span className="break-all font-medium">{String(p.email?.value ?? p.emailVerification.email)}</span><VerificationBadge ev={p.emailVerification} /></div>
                      ) : p.email ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="break-all font-medium">{String(p.email.value)}</span>
                          <Pill tone="muted" className="normal-case">Not verified</Pill>
                          <Button size="sm" variant="brand" className="h-7 gap-1.5 px-2 text-xs" disabled={finding || bulkVerifying} onClick={() => verifyOne.mutate(p.id)}>{finding ? <Loader2 className="animate-spin" /> : <MailCheck />}{finding ? "Verifying…" : "Verify"}</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="brand" className="h-7 gap-1.5 px-2 text-xs" disabled={finding || bulkVerifying} onClick={() => verifyOne.mutate(p.id)}>{finding ? <Loader2 className="animate-spin" /> : <MailCheck />}{finding ? "Finding…" : "Access email"}</Button>
                      )}
                    </div>
                    {(p.linkedin || p.location) && (
                      <div className="flex items-center gap-3 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                        {p.linkedin && <a href={linkedinHref(String(p.linkedin.value))} target="_blank" rel="noreferrer" className="inline-flex size-6 items-center justify-center rounded-md bg-surface transition-colors hover:text-brand" aria-label="LinkedIn"><Linkedin className="size-3.5" strokeWidth={1.75} /></a>}
                        {p.location && <span className="min-w-0 truncate">{p.location}</span>}
                      </div>
                    )}
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
                      <DropdownMenu align="start" trigger={<button className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground" aria-label="Selection options"><ChevronDown className="size-3.5" /></button>}>
                        <DropdownItem onClick={selectThisPage}>Select this page ({pageIds.length})</DropdownItem>
                        <DropdownItem onClick={selectAll}>Select all {formatNumber(total)}</DropdownItem>
                        {someSelected && <><DropdownSeparator /><DropdownItem onClick={clearSelection}>Clear selection</DropdownItem></>}
                      </DropdownMenu>
                    </div>
                  </th>
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
                  const selected = rowChecked(p.id);
                  const finding = inflightIds.has(p.id);
                  const rowTags = tagsForRow(p.id);
                  return (
                    <tr key={p.id} onClick={() => onOpenPerson(p)} className={cn("group cursor-pointer border-b border-border transition-colors hover:bg-surface/60", rowTags[0] && TAG_STYLES[rowTags[0].color].row, selected && "bg-brand/[0.05] hover:bg-brand/[0.07]")}>
                      <td className="py-2.5 pl-4 pr-2 align-top sm:pl-6" onClick={(e) => e.stopPropagation()}><div className="pt-1.5"><Check checked={selected} onChange={() => toggleRow(p.id)} /></div></td>
                      <td className="min-w-[160px] max-w-[240px] px-3 py-2.5 align-top">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <Avatar name={p.name} seed={p.id} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate pt-0.5 font-semibold leading-snug text-foreground transition-colors group-hover:text-brand">{p.name}</p>
                            {(personHasFunding(p) || p.llmVerification || rowTags.length > 0 || (p.altName && p.altName !== p.name)) && (
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {personHasFunding(p) && (
                                  <span title={`Company funding: ${p.companyFunding}`}><Pill tone="valid"><DollarSign className="size-3" /> Funded</Pill></span>
                                )}
                                {p.llmVerification && <LlmBadge v={p.llmVerification} />}
                                {rowTags.map((t) => (
                                  <span key={t.id} className={cn("inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold", TAG_STYLES[t.color].pill)} title={`AI tag: ${t.label}`}>{t.label}</span>
                                ))}
                                {p.altName && p.altName !== p.name && (
                                  <span
                                    className="inline-flex max-w-full shrink-0 items-center truncate rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                                    title={`Name corrected via LinkedIn (title + company); the email was found using "${p.altName}"`}
                                  >
                                    alt: {p.altName}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      {show("title") && (
                        <td className="min-w-[200px] max-w-[420px] px-3 py-2.5 align-top text-muted-foreground">
                          <span className="whitespace-normal break-words">{p.title?.value ?? "—"}</span>
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
                          // Imported email — shown as-is with a "not verified" note.
                          // Full address on its own line; the note + Verify sit below
                          // so the email is never truncated. Verify only VERIFIES it.
                          <div className="flex flex-col items-start gap-1">
                            <span className="break-all text-xs font-medium text-foreground">{String(p.email.value)}</span>
                            <div className="flex items-center gap-1.5">
                              <Pill tone="muted" className="normal-case">Not verified</Pill>
                              <Button
                                size="sm"
                                variant="brand"
                                className="h-7 gap-1.5 px-2 text-xs"
                                disabled={finding || bulkVerifying}
                                onClick={() => verifyOne.mutate(p.id)}
                                title={finding ? "Verifying email…" : "Verify this email"}
                              >
                                {finding ? <Loader2 className="animate-spin" /> : <MailCheck />}
                                {finding ? "Verifying…" : "Verify"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="brand"
                            className="h-7 gap-1.5 px-2 text-xs"
                            disabled={finding || bulkVerifying}
                            onClick={() => verifyOne.mutate(p.id)}
                            title={finding ? "Finding email…" : "Find & verify this person's email"}
                          >
                            {finding ? <Loader2 className="animate-spin" /> : <MailCheck />}
                            {finding ? "Finding…" : "Access email"}
                          </Button>
                        )}
                      </td>
                      )}
                      {show("company") && (
                        <td className="min-w-[200px] max-w-[380px] px-3 py-2.5 align-top">
                          <div className="flex min-w-0 items-start gap-2">
                            <CompanyLogo domain={p.companyDomain} text={p.companyLogoText} className="mt-0.5 size-6 text-[10px]" />
                            <span className="whitespace-normal break-words pt-0.5 font-medium text-foreground">{p.company}</span>
                          </div>
                        </td>
                      )}
                      {show("companyEmployees") && (
                        <td className="whitespace-nowrap px-3 py-2.5 text-center align-top tabular-nums text-muted-foreground">{p.companyEmployees || <span className="text-muted-foreground/60">—</span>}</td>
                      )}
                      {show("companyIndustry") && (
                        <td className="min-w-[140px] max-w-[240px] px-3 py-2.5 align-top text-muted-foreground">
                          <span className="whitespace-normal break-words">{p.companyIndustry || "—"}</span>
                        </td>
                      )}
                      {show("seniority") && (
                        <td className="px-3 py-2.5 align-top"><Pill tone={SENIORITY_TONE[p.seniority]} className="normal-case">{SENIORITY_LABEL[p.seniority]}</Pill></td>
                      )}
                      {show("companyPhone") && (
                        <td className="whitespace-nowrap px-3 py-2.5 align-top tabular-nums text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                          {p.companyPhone ? <a href={`tel:${p.companyPhone}`} className="transition-colors hover:text-brand">{p.companyPhone}</a> : <span className="text-muted-foreground/60">—</span>}
                        </td>
                      )}
                      {show("companyEmail") && (
                        <td className="max-w-[220px] px-3 py-2.5 align-top text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                          {p.companyEmail ? <a href={`mailto:${p.companyEmail}`} className="line-clamp-1 transition-colors hover:text-brand">{p.companyEmail}</a> : <span className="text-muted-foreground/60">—</span>}
                        </td>
                      )}
                      {show("linkedin") && (
                        <td className="px-3 py-2.5 align-top" onClick={(e) => e.stopPropagation()}>
                          {p.linkedin ? (
                            <a href={linkedinHref(String(p.linkedin.value))} target="_blank" rel="noreferrer" className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-brand/10 hover:text-brand" aria-label="View LinkedIn"><Linkedin className="size-4" strokeWidth={1.75} /></a>
                          ) : <span className="text-muted-foreground/60">—</span>}
                        </td>
                      )}
                      {show("location") && (
                        <td className="whitespace-nowrap px-3 py-2.5 align-top text-muted-foreground">{p.location ?? "—"}</td>
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
        <div className="flex items-center justify-between gap-3 border-t border-border bg-card px-4 py-2.5 text-xs text-muted-foreground sm:px-6">
          <span><span className="font-semibold tabular-nums text-foreground">{formatNumber(total)}</span> people</span>
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
          <div className="pointer-events-auto flex max-w-full animate-fade-in flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-card/95 p-1.5 pl-3 shadow-pop backdrop-blur">
            <span className="flex items-center gap-2 pr-1 text-sm font-semibold">
              <span className="rounded-md bg-brand/10 px-2 py-0.5 text-brand tabular-nums">{formatNumber(effectiveCount)}</span> selected
            </span>
            {!allMatching && total > selectedIds.size && (
              <button onClick={selectAll} className="text-xs font-medium text-brand hover:underline">Select all {formatNumber(total)}</button>
            )}
            <div className="h-6 w-px bg-border" />
            <DropdownMenu up align="end" trigger={<Button size="sm" variant="ghost" disabled={busy !== null}>{busy === "list" ? <Loader2 className="animate-spin" /> : <ListPlus />} Add to list <ChevronDown /></Button>}>
              {lists.map((l) => <DropdownItem key={l.id} onClick={() => addSelectedToList(l.id, l.name)}><ListPlus /> {l.name} <span className="ml-auto text-xs tabular-nums text-muted-foreground">{l.summary.total}</span></DropdownItem>)}
              {lists.length > 0 && <DropdownSeparator />}
              <DropdownItem onClick={() => { setNewListName(""); setNewListOpen(true); }}><Plus /> New list</DropdownItem>
            </DropdownMenu>
            <Button size="sm" onClick={onExport} disabled={busy !== null} title={allMatching ? "Exports all matching records." : "Exports the checked records (all fields)."}>{busy === "export" ? <Loader2 className="animate-spin" /> : <Download />} Export</Button>
            <Button size="icon" variant="ghost" onClick={clearSelection} className="size-8" aria-label="Clear selection"><X /></Button>
          </div>
        </div>
      )}

      {/* New list dialog — name it (same as the /lists screen), then add the selection. */}
      <Dialog open={newListOpen} onOpenChange={(o) => { if (!o) { setNewListOpen(false); setNewListName(""); } }}>
        <DialogHeader>
          <IconTile icon={ListPlus} tone="brand" className="mb-3" />
          <DialogTitle>New list</DialogTitle>
          <DialogDescription>Name the list, then add the {formatNumber(effectiveCount)} selected {effectiveCount === 1 ? "person" : "people"}.</DialogDescription>
        </DialogHeader>
        <Field label="List name" htmlFor="people-new-list-name">
          <Input
            id="people-new-list-name"
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

/** Clickable, sortable column header. Cycles asc → desc → off via onSort. */
function SortHeader({ label, field, sortField, sortDir, onSort, align }: {
  label: string; field: string; sortField: string | null; sortDir: "asc" | "desc"; onSort: (f: string) => void; align?: "center";
}) {
  const active = sortField === field;
  return (
    <th className={cn("whitespace-nowrap px-3 py-3 font-normal", align === "center" && "text-center")}>
      <button onClick={() => onSort(field)} className={cn("inline-flex items-center gap-1 transition-colors hover:text-foreground", active && "text-brand")} title={`Sort by ${label}`}>
        <ColHead label={label} />
        {active ? (sortDir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-40" />}
      </button>
    </th>
  );
}

/** Column show/hide picker. Its own popover (stays open across toggles). */
function ColumnsMenu({ cols, onToggle, onReset }: { cols: Record<ColKey, boolean>; onToggle: (k: ColKey) => void; onReset: () => void }) {
  return <SharedColumnsMenu defs={COLUMN_DEFS} cols={cols} onToggle={onToggle} onReset={onReset} />;
}

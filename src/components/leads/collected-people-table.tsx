"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Inbox, Loader2, ChevronRight, Linkedin, ChevronDown, ListPlus, Download, X, Plus, SlidersHorizontal, MailCheck, DollarSign, Columns3, ArrowUp, ArrowDown, ArrowUpDown, Sparkles, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { getCollectedPeople, verifyPersonEmail, getLeadLists, createLeadList, addPeopleToList, aiTagPeople, ApiError, type AiTagColor, type PeopleAddSelection } from "@/lib/api/client";
import { formatNumber, cn } from "@/lib/utils";
import { addToListToast } from "@/lib/leads/lead-snapshot";
import { toCsv, downloadCsv } from "@/lib/leads/csv";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
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

/**
 * City / State / Country for export. Uses the separately-stored fields when the
 * person carries them; otherwise best-effort splits the combined `location`
 * ("City, State, Country" — some parts may be missing): 1 part → city; 2 →
 * city + country; 3+ → city + state + country.
 */
function splitLocation(p: CollectedPerson): { city: string; state: string; country: string } {
  if (p.city || p.state || p.country) return { city: p.city ?? "", state: p.state ?? "", country: p.country ?? "" };
  const parts = (p.location ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { city: "", state: "", country: "" };
  if (parts.length === 1) return { city: parts[0], state: "", country: "" };
  if (parts.length === 2) return { city: parts[0], state: "", country: parts[1] };
  return { city: parts[0], state: parts.slice(1, -1).join(", "), country: parts[parts.length - 1] };
}

const SENIORITY_STYLE: Record<PersonSeniority, string> = {
  founder: "bg-[hsl(var(--valid))]/12 text-[hsl(var(--valid))]",
  c_level: "bg-primary/12 text-primary",
  president: "bg-primary/12 text-primary",
  vp: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  other: "bg-muted text-muted-foreground",
};

// AI Support tags — colour → pill + row-accent classes (literal so Tailwind keeps them).
const TAG_STYLES: Record<AiTagColor, { pill: string; row: string }> = {
  amber:  { pill: "bg-amber-500/15 text-amber-700 dark:text-amber-300",   row: "border-l-2 border-l-amber-500" },
  blue:   { pill: "bg-blue-500/15 text-blue-700 dark:text-blue-300",      row: "border-l-2 border-l-blue-500" },
  green:  { pill: "bg-green-500/15 text-green-700 dark:text-green-300",    row: "border-l-2 border-l-green-500" },
  purple: { pill: "bg-purple-500/15 text-purple-700 dark:text-purple-300", row: "border-l-2 border-l-purple-500" },
  red:    { pill: "bg-red-500/15 text-red-700 dark:text-red-300",          row: "border-l-2 border-l-red-500" },
  teal:   { pill: "bg-teal-500/15 text-teal-700 dark:text-teal-300",       row: "border-l-2 border-l-teal-500" },
  pink:   { pill: "bg-pink-500/15 text-pink-700 dark:text-pink-300",       row: "border-l-2 border-l-pink-500" },
  orange: { pill: "bg-orange-500/15 text-orange-700 dark:text-orange-300", row: "border-l-2 border-l-orange-500" },
};

type AiTag = { id: string; label: string; color: AiTagColor; ids: Set<string> };

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
  jobName,
  live,
  bulkVerifying = false,
  verifyingPersonIds: jobVerifyingIds,
  onOpenPerson,
}: {
  jobId: string;
  jobName?: string;
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
      const headers = ["First Name", "Last Name", "Company Name", "Company Website", "Email", "Full Name", "LinkedIn", "Title", "Industry", "Employees Count", "City", "State", "Country"];
      const csv = toCsv(headers, sel.map((p) => {
        const loc = splitLocation(p);
        return [
          p.firstName, p.lastName, p.company, p.companyDomain ?? "",
          p.email?.value ?? "", p.name, p.linkedin?.value ?? "", p.title?.value ?? "",
          p.companyIndustry ?? "", p.companyEmployees ?? "", loc.city, loc.state, loc.country,
        ];
      }));
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
        <aside className="hidden w-64 shrink-0 flex-col overflow-hidden border-r bg-muted/10 md:flex">
          <PeopleFilterPanel filters={filters} facets={facets} onChange={setFilters} onClear={() => setFilters(EMPTY_PEOPLE_FILTERS)} />
        </aside>
      )}
      <MobileFilterDrawer open={mobileFilters} onClose={() => setMobileFilters(false)}>
        <PeopleFilterPanel filters={filters} facets={facets} onChange={setFilters} onClear={() => setFilters(EMPTY_PEOPLE_FILTERS)} />
      </MobileFilterDrawer>
      <div className="relative flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, title or company…" className="h-9 pl-9" />
        </div>
        <span className="hidden text-sm text-muted-foreground sm:inline"><span className="font-semibold text-foreground tabular-nums">{formatNumber(total)}</span> people</span>
        <div className="flex shrink-0 items-center gap-1.5 sm:ml-auto sm:gap-2">
          <div className="relative">
            <Button size="sm" variant={aiOpen || aiTags.length > 0 ? "secondary" : "outline"} className="h-9" onClick={() => setAiOpen((o) => !o)} title="Ask AI to tag rows by a natural-language instruction.">
              <Sparkles className="size-4" /> <span className="hidden sm:inline">AI Support</span>{aiTags.length > 0 && <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary sm:ml-1">{aiTags.length}</span>}
            </Button>
            {aiOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setAiOpen(false)} />
                <div className="absolute right-0 z-30 mt-1 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border bg-card p-3 shadow-lg">
                  <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="size-4 text-primary" /> AI Support</div>
                  <p className="mb-2 text-xs text-muted-foreground">Describe what to tag. The AI highlights matching people in the table.</p>
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
                      {aiBusy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                      {aiBusy ? "Running…" : "Run"}
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {["Highlight Indian names", "Tag founders & CEOs", "Mark fintech companies", "Flag people with no email"].map((ex) => (
                      <button key={ex} onClick={() => setAiPrompt(ex)} disabled={aiBusy} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50">{ex}</button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <ColumnsMenu cols={cols} onToggle={toggleCol} onReset={resetCols} />
          <Button size="sm" variant={showFilters ? "secondary" : "outline"} className="h-9" onClick={() => openFiltersFor(setShowFilters, setMobileFilters)}>
            <SlidersHorizontal className="size-4" /> <span className="hidden sm:inline">Filters</span>{filtersActive > 0 && <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary sm:ml-1">{filtersActive}</span>}
          </Button>
        </div>
      </div>

      {aiTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/10 px-4 py-2 text-xs">
          <Sparkles className="size-3.5 text-muted-foreground" />
          <span className="mr-0.5 font-medium text-muted-foreground">AI tags:</span>
          {aiTags.map((t) => {
            const on = activeTagId === t.id;
            return (
              <span key={t.id} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium", TAG_STYLES[t.color].pill, on && "ring-2 ring-inset ring-current")}>
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
            ? <button onClick={() => setActiveTagId(null)} className="ml-1 font-medium text-primary hover:underline">Show all</button>
            : <span className="ml-1 text-muted-foreground">· click a tag to filter</span>}
          <button onClick={() => { setAiTags([]); setActiveTagId(null); }} className="ml-auto text-muted-foreground hover:text-foreground">Clear all</button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : total === 0 ? (
          filtersActive > 0 || debounced ? (
            <EmptyState
              icon={Search}
              title="No people match your filters"
              description="No one matches the current filters and search. Try removing some to see more."
              action={<Button variant="outline" onClick={() => { setFilters(EMPTY_PEOPLE_FILTERS); setSearch(""); }}><X className="size-4" /> Clear filters</Button>}
              className="m-6"
            />
          ) : (
            <EmptyState icon={Inbox} title="No people found yet" description="People appear here as each company is crawled." className="m-6" />
          )
        ) : (
          <>
          {/* Mobile: people cards */}
          <div className={cn("scrollbar-thin h-full space-y-2 overflow-auto p-3 transition-opacity md:hidden", isPlaceholderData && "opacity-60")}>
            {rows.map((p) => {
              const selected = rowChecked(p.id);
              const finding = inflightIds.has(p.id);
              const rowTags = tagsForRow(p.id);
              return (
                <div key={p.id} onClick={() => onOpenPerson(p)} className={cn("rounded-xl border p-3 transition-colors active:bg-muted/40", rowTags[0] && TAG_STYLES[rowTags[0].color].row, selected && "border-primary/40 bg-primary/[0.04]")}>
                  <div className="flex items-start gap-2.5">
                    <div className="pt-0.5" onClick={(e) => e.stopPropagation()}><Check checked={selected} onChange={() => toggleRow(p.id)} /></div>
                    <Avatar name={p.name} seed={p.id} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 truncate font-medium">{p.name}</span>
                        {personHasFunding(p) && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[hsl(var(--valid))]/10 px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--valid))]"><DollarSign className="size-3" /> Funded</span>}
                        {p.llmVerification && <LlmBadge v={p.llmVerification} />}
                        {rowTags.map((t) => <span key={t.id} className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium", TAG_STYLES[t.color].pill)}>{t.label}</span>)}
                      </div>
                      {p.title?.value && <p className="truncate text-xs text-muted-foreground">{p.title.value}</p>}
                    </div>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  </div>
                  <div className="mt-2 space-y-1.5 pl-[26px] text-xs">
                    <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                      <CompanyLogo domain={p.companyDomain} text={p.companyLogoText} className="size-5 shrink-0 text-[9px]" />
                      <span className="min-w-0 truncate">{p.company}</span>
                      <span className={cn("ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", SENIORITY_STYLE[p.seniority])}>{SENIORITY_LABEL[p.seniority]}</span>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      {p.emailVerification ? (
                        isUnconfirmedEmail(p) ? <span className="text-muted-foreground">Not found</span>
                          : <div className="flex flex-wrap items-center gap-1.5"><span className="break-all">{String(p.email?.value ?? p.emailVerification.email)}</span><VerificationBadge ev={p.emailVerification} /></div>
                      ) : p.email ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="break-all">{String(p.email.value)}</span>
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Not verified</span>
                          <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" disabled={finding || bulkVerifying} onClick={() => verifyOne.mutate(p.id)}>{finding ? <Loader2 className="size-3.5 animate-spin" /> : <MailCheck className="size-3.5" />}{finding ? "Verifying…" : "Verify"}</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" disabled={finding || bulkVerifying} onClick={() => verifyOne.mutate(p.id)}>{finding ? <Loader2 className="size-3.5 animate-spin" /> : <MailCheck className="size-3.5" />}{finding ? "Finding…" : "Access email"}</Button>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                      {p.linkedin && <a href={linkedinHref(String(p.linkedin.value))} target="_blank" rel="noreferrer" className="hover:text-primary" aria-label="LinkedIn"><Linkedin className="size-4" /></a>}
                      {p.location && <span className="min-w-0 truncate">{p.location}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop: table */}
          <div className={cn("scrollbar-thin hidden h-full overflow-auto transition-opacity md:block", isPlaceholderData && "opacity-60")}>
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
                  const selected = rowChecked(p.id);
                  const finding = inflightIds.has(p.id);
                  const rowTags = tagsForRow(p.id);
                  return (
                    <tr key={p.id} onClick={() => onOpenPerson(p)} className={cn("cursor-pointer border-b hover:bg-muted/30", rowTags[0] && TAG_STYLES[rowTags[0].color].row, selected && "bg-primary/[0.04]")}>
                      <td className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}><Check checked={selected} onChange={() => toggleRow(p.id)} /></td>
                      <td className="min-w-[160px] max-w-[240px] px-3 py-2 align-top">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                          <Avatar name={p.name} seed={p.id} />
                          <span className="min-w-0 truncate font-medium">{p.name}</span>
                          {personHasFunding(p) && (
                            <span
                              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[hsl(var(--valid))]/10 px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--valid))]"
                              title={`Company funding: ${p.companyFunding}`}
                            >
                              <DollarSign className="size-3" /> Funded
                            </span>
                          )}
                          {p.llmVerification && <LlmBadge v={p.llmVerification} />}
                          {rowTags.map((t) => (
                            <span key={t.id} className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium", TAG_STYLES[t.color].pill)} title={`AI tag: ${t.label}`}>{t.label}</span>
                          ))}
                        </div>
                      </td>
                      {show("title") && (
                        <td className="min-w-[200px] max-w-[420px] px-3 py-2 align-top text-muted-foreground">
                          <span className="whitespace-normal break-words">{p.title?.value ?? "—"}</span>
                        </td>
                      )}
                      {show("email") && (
                      <td className="min-w-[220px] max-w-[360px] px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}>
                        {p.emailVerification ? (
                          isUnconfirmedEmail(p) ? (
                            <span className="text-xs text-muted-foreground">Not found</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <span className="break-all text-xs">{String(p.email?.value ?? p.emailVerification.email)}</span>
                              <div><VerificationBadge ev={p.emailVerification} /></div>
                            </div>
                          )
                        ) : p.email ? (
                          // Imported email — shown as-is with a "not verified" note.
                          // Full address on its own line; the note + Verify sit below
                          // so the email is never truncated. Verify only VERIFIES it.
                          <div className="flex flex-col gap-1">
                            <span className="break-all text-xs">{String(p.email.value)}</span>
                            <div className="flex items-center gap-1.5">
                              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Not verified</span>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1.5 px-2 text-xs"
                                disabled={finding || bulkVerifying}
                                onClick={() => verifyOne.mutate(p.id)}
                                title={finding ? "Verifying email…" : "Verify this email"}
                              >
                                {finding ? <Loader2 className="size-3.5 animate-spin" /> : <MailCheck className="size-3.5" />}
                                {finding ? "Verifying…" : "Verify"}
                              </Button>
                            </div>
                          </div>
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
                      )}
                      {show("company") && (
                        <td className="min-w-[200px] max-w-[380px] px-3 py-2 align-top">
                          <div className="flex min-w-0 items-start gap-2">
                            <CompanyLogo domain={p.companyDomain} text={p.companyLogoText} className="mt-0.5 size-6 text-[10px]" />
                            <span className="whitespace-normal break-words">{p.company}</span>
                          </div>
                        </td>
                      )}
                      {show("companyEmployees") && (
                        <td className="whitespace-nowrap px-3 py-2 text-center align-top text-muted-foreground">{p.companyEmployees || <span className="text-xs">—</span>}</td>
                      )}
                      {show("companyIndustry") && (
                        <td className="min-w-[140px] max-w-[240px] px-3 py-2 align-top text-muted-foreground">
                          <span className="whitespace-normal break-words">{p.companyIndustry || "—"}</span>
                        </td>
                      )}
                      {show("seniority") && (
                        <td className="px-3 py-2 align-top"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", SENIORITY_STYLE[p.seniority])}>{SENIORITY_LABEL[p.seniority]}</span></td>
                      )}
                      {show("companyPhone") && (
                        <td className="whitespace-nowrap px-3 py-2 align-top text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                          {p.companyPhone ? <a href={`tel:${p.companyPhone}`} className="hover:text-primary">{p.companyPhone}</a> : <span className="text-xs">—</span>}
                        </td>
                      )}
                      {show("companyEmail") && (
                        <td className="max-w-[220px] px-3 py-2 align-top text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                          {p.companyEmail ? <a href={`mailto:${p.companyEmail}`} className="line-clamp-1 hover:text-primary">{p.companyEmail}</a> : <span className="text-xs">—</span>}
                        </td>
                      )}
                      {show("linkedin") && (
                        <td className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}>
                          {p.linkedin ? (
                            <a href={linkedinHref(String(p.linkedin.value))} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary" aria-label="View LinkedIn"><Linkedin className="size-4" /></a>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                      )}
                      {show("location") && (
                        <td className="whitespace-nowrap px-3 py-2 align-top text-muted-foreground">{p.location ?? "—"}</td>
                      )}
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
            <DropdownMenu up align="end" trigger={<Button size="sm" variant="ghost" disabled={busy !== null}>{busy === "list" ? <Loader2 className="size-4 animate-spin" /> : <ListPlus className="size-4" />} Add to list <ChevronDown className="size-3.5" /></Button>}>
              {lists.map((l) => <DropdownItem key={l.id} onClick={() => addSelectedToList(l.id, l.name)}><ListPlus /> {l.name} <span className="ml-auto text-xs text-muted-foreground">{l.summary.total}</span></DropdownItem>)}
              {lists.length > 0 && <DropdownSeparator />}
              <DropdownItem onClick={() => { setNewListName(""); setNewListOpen(true); }}><Plus /> New list</DropdownItem>
            </DropdownMenu>
            <Button size="sm" variant="outline" onClick={onExport} disabled={busy !== null} title={allMatching ? "Exports all matching records." : "Exports the checked records (all fields)."}>{busy === "export" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Export</Button>
            <button onClick={clearSelection} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Clear selection"><X className="size-4" /></button>
          </div>
        </div>
      )}

      {/* New list dialog — name it (same as the /lists screen), then add the selection. */}
      <Dialog open={newListOpen} onOpenChange={(o) => { if (!o) { setNewListOpen(false); setNewListName(""); } }}>
        <DialogHeader>
          <DialogTitle>New list</DialogTitle>
          <DialogDescription>Name the list, then add the {formatNumber(effectiveCount)} selected {effectiveCount === 1 ? "person" : "people"}.</DialogDescription>
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

/** Clickable, sortable column header. Cycles asc → desc → off via onSort. */
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

/** Column show/hide picker. Its own popover (stays open across toggles). */
function ColumnsMenu({ cols, onToggle, onReset }: { cols: Record<ColKey, boolean>; onToggle: (k: ColKey) => void; onReset: () => void }) {
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
  const shown = COLUMN_DEFS.filter((c) => cols[c.key]).length;
  return (
    <div ref={ref} className="relative inline-block text-left">
      <Button size="sm" variant="outline" className="h-9" onClick={() => setOpen((o) => !o)}>
        <Columns3 className="size-4" /> <span className="hidden sm:inline">Columns</span>
        <span className="ml-0.5 rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground tabular-nums sm:ml-1">{shown}</span>
      </Button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-56 animate-fade-in rounded-lg border bg-popover p-1.5 shadow-lg" style={{ fontFamily: "var(--font-sans), system-ui, sans-serif" }}>
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Show columns</span>
            <button onClick={onReset} className="text-[11px] font-medium text-primary hover:underline">Reset</button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {COLUMN_DEFS.map((c) => (
              <label key={c.key} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent">
                <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border transition-colors", cols[c.key] ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card")}>
                  {cols[c.key] && <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </span>
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

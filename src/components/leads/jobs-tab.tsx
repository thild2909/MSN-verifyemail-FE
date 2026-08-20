"use client";
import * as React from "react";
import { X, Bookmark, ListPlus, Workflow, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatNumber } from "@/lib/utils";
import { queryJobs } from "@/lib/leads/data";
import { DEFAULT_JOB_FILTERS, type Job, type JobFilters, type SortState } from "@/lib/leads/types";
import { JobFilterSidebar } from "./job-filter-sidebar";
import { JobsTable, type JobAction } from "./jobs-table";
import { JobDetailDrawer } from "./job-detail-drawer";

const PAGE_SIZE = 25;

function countActive(f: JobFilters): number {
  let n = f.titles.length + f.workModes.length + f.employmentTypes.length + f.seniority.length + f.technologies.length + f.companySizes.length + f.hiringSignals.length;
  if (f.country !== "all") n++;
  if (f.postedWithinDays > 0) n++;
  if (f.salaryMin > 0) n++;
  return n;
}

export function JobsTab({ filtersVisible, search }: { filtersVisible: boolean; search: string }) {
  const { toast } = useToast();
  const [filters, setFilters] = React.useState<JobFilters>(DEFAULT_JOB_FILTERS);
  const [sort, setSort] = React.useState<SortState | null>(null);
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [drawer, setDrawer] = React.useState<Job | null>(null);

  React.useEffect(() => { setPage(1); }, [filters, sort, search]);

  const result = React.useMemo(() => queryJobs({ ...filters, search }, sort, page, PAGE_SIZE), [filters, search, sort, page]);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const pageIds = result.rows.map((r) => r.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const patch = (p: Partial<JobFilters>) => setFilters((f) => ({ ...f, ...p }));
  const clear = () => setFilters(DEFAULT_JOB_FILTERS);
  const onSort = (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "posted" ? "asc" : "asc" }));
  const toggleRow = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAllPage = () => setSelected((s) => { const n = new Set(s); allPageSelected ? pageIds.forEach((id) => n.delete(id)) : pageIds.forEach((id) => n.add(id)); return n; });

  const ACTION_LABEL: Record<JobAction, string> = { save: "Saved job", find_decision_makers: "Finding decision makers", view_company: "Opening company", add_workflow: "Added to workflow" };
  const onAction = (a: JobAction, j: Job) => toast({ variant: a === "save" ? "success" : "info", title: ACTION_LABEL[a], description: `${j.title} · ${j.company}` });
  const onBulk = (label: string) => toast({ variant: "success", title: `${label} — ${formatNumber(selected.size)} jobs` });

  const activeCount = countActive(filters);

  return (
    <div className="flex min-h-0 flex-1">
      {filtersVisible && (
        <aside className="hidden w-[280px] shrink-0 overflow-hidden border-r bg-muted/20 md:block">
          <JobFilterSidebar filters={filters} onChange={patch} activeCount={activeCount} onClear={clear} />
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
          <span className="text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{formatNumber(result.total)}</span> jobs
            {selected.size > 0 && <> · <span className="font-medium text-primary">{formatNumber(selected.size)} selected</span></>}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
            <span className="text-xs tabular-nums text-muted-foreground">Page {page} / {totalPages}</span>
            <Button size="sm" variant="outline" className="h-8" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {result.total === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-base font-semibold">No jobs match your filters</p>
              <p className="text-sm text-muted-foreground">Try widening a filter or clearing the search.</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={clear}>Clear filters</Button>
            </div>
          ) : (
            <JobsTable
              rows={result.rows}
              sort={sort}
              onSort={onSort}
              selectedIds={selected}
              onToggleRow={toggleRow}
              onToggleAllPage={toggleAllPage}
              allPageSelected={allPageSelected}
              onOpenJob={setDrawer}
              onAction={onAction}
            />
          )}
        </div>
      </div>

      {/* Jobs bulk bar */}
      {selected.size > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-2 rounded-xl border bg-card/95 p-2 pl-4 shadow-2xl backdrop-blur">
            <span className="flex items-center gap-2 pr-1 text-sm font-semibold"><span className="rounded-md bg-primary px-2 py-0.5 text-primary-foreground tabular-nums">{formatNumber(selected.size)}</span> selected</span>
            <div className="h-6 w-px bg-border" />
            <Button size="sm" variant="ghost" onClick={() => onBulk("Saved")}><Bookmark className="size-4" /> Save</Button>
            <Button size="sm" variant="ghost" onClick={() => onBulk("Added to list")}><ListPlus className="size-4" /> Add to list</Button>
            <Button size="sm" variant="ghost" onClick={() => onBulk("Added to workflow")}><Workflow className="size-4" /> Workflow</Button>
            <Button size="sm" variant="outline" onClick={() => onBulk("Exported")}><Download className="size-4" /> Export</Button>
            <button onClick={() => setSelected(new Set())} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Clear selection"><X className="size-4" /></button>
          </div>
        </div>
      )}

      <JobDetailDrawer job={drawer} open={!!drawer} onOpenChange={(o) => !o && setDrawer(null)} onAction={onAction} />
    </div>
  );
}

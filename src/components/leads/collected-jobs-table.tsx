"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, MapPin, Briefcase, Search, SlidersHorizontal } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { getCrawledJobs, type CrawledJobsQuery } from "@/lib/api/client";
import { JOB_SOURCE_LABEL, type CollectedJob, type JobSource } from "@/lib/leads/job-collect-types";
import type { JobFilters } from "@/lib/leads/types";
import { CompanyLogo } from "./leads-ui";
import { JobFilterSidebar } from "./job-filter-sidebar";
import { MobileFilterDrawer, openFiltersFor } from "./filter-drawer";

const PAGE_SIZE = 25;

/** Per-source colour so the Source column is scannable at a glance. */
const SOURCE_CLASS: Record<JobSource, string> = {
  seek: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  indeed: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  reed: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  dice: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  ctgoodjobs: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  foundit: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  glassdoor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  mycareersfuture: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
  wellfound: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  "startups-gallery": "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
};

export function SourceBadge({ source }: { source: JobSource }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", SOURCE_CLASS[source] ?? "bg-muted text-muted-foreground")}>
      {JOB_SOURCE_LABEL[source] ?? source}
    </span>
  );
}

function postedLabel(j: CollectedJob): string {
  if (j.posted) return j.posted;
  if (j.postedDaysAgo == null) return "—";
  if (j.postedDaysAgo <= 0) return "Today";
  if (j.postedDaysAgo === 1) return "Yesterday";
  if (j.postedDaysAgo < 7) return `${j.postedDaysAgo}d ago`;
  if (j.postedDaysAgo < 30) return `${Math.round(j.postedDaysAgo / 7)}w ago`;
  return "30+ days ago";
}

/**
 * Roles table. Mirrors the People/Companies tables: a toggleable left filter
 * sidebar (inline on md+, a drawer on mobile), a toolbar with a search box +
 * count + Filters button, and bottom pagination. The filter state is owned by
 * the parent Jobs tab (it also seeds the crawl), so it's passed in and this
 * component drives the sidebar through the same handlers.
 */
export function CollectedJobsTable({
  jobId,
  live,
  query,
  filters,
  onChangeFilters,
  onClearFilters,
  activeFilterCount,
}: {
  jobId: string;
  live: boolean;
  query: Omit<CrawledJobsQuery, "page" | "pageSize" | "search">;
  filters: JobFilters;
  onChangeFilters: (patch: Partial<JobFilters>) => void;
  onClearFilters: () => void;
  activeFilterCount: number;
}) {
  const [showFilters, setShowFilters] = React.useState(true);
  const [mobileFilters, setMobileFilters] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);

  const queryKeyStr = JSON.stringify(query);
  const effQuery = React.useMemo(() => ({ ...query, search: debounced }), [queryKeyStr, debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { setPage(1); }, [jobId, debounced, queryKeyStr]);

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["crawled-jobs", jobId, effQuery, page],
    queryFn: () => getCrawledJobs(jobId, { ...effQuery, page, pageSize: PAGE_SIZE }),
    refetchInterval: live ? 2000 : false,
    placeholderData: (prev) => prev,
  });

  const rows = data?.jobs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex min-h-0 flex-1">
      {showFilters && (
        <aside className="hidden w-64 shrink-0 flex-col overflow-hidden border-r bg-muted/10 md:flex">
          <JobFilterSidebar filters={filters} onChange={onChangeFilters} activeCount={activeFilterCount} onClear={onClearFilters} />
        </aside>
      )}
      <MobileFilterDrawer open={mobileFilters} onClose={() => setMobileFilters(false)}>
        <JobFilterSidebar filters={filters} onChange={onChangeFilters} activeCount={activeFilterCount} onClear={onClearFilters} />
      </MobileFilterDrawer>

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <div className="relative w-full min-w-[200px] sm:w-auto sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search role, company or location…" className="h-9 pl-9" />
          </div>
          <span className="text-sm text-muted-foreground"><span className="font-semibold text-foreground tabular-nums">{formatNumber(total)}</span> roles</span>
          <Button size="sm" variant={showFilters ? "secondary" : "outline"} className="ml-auto h-9" onClick={() => openFiltersFor(setShowFilters, setMobileFilters)}>
            <SlidersHorizontal className="size-4" /> Filters{activeFilterCount > 0 && <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">{activeFilterCount}</span>}
          </Button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1">
          {isLoading && !data ? (
            <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : total === 0 ? (
            <EmptyState
              icon={Briefcase}
              title={live ? "Crawling job boards…" : "No roles found"}
              description={live ? "Roles will appear here as each source returns." : "The sources returned no matching roles, or were blocked. Try clearing the filter."}
              className="m-6"
            />
          ) : (
            <div className={cn("scrollbar-thin h-full overflow-auto transition-opacity", isPlaceholderData && "opacity-60")}>
              <table className="w-full border-collapse text-[13px]">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b text-left font-medium text-muted-foreground">
                    <th className="px-3 py-2.5">Job</th>
                    <th className="px-3 py-2.5">Company</th>
                    <th className="px-3 py-2.5">Location</th>
                    <th className="px-3 py-2.5">Source</th>
                    <th className="px-3 py-2.5">Salary</th>
                    <th className="px-3 py-2.5">Posted</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((j) => (
                    <tr key={j.id} className="group border-b transition-colors hover:bg-muted/40">
                      <td className="px-3 py-2">
                        <a href={j.url || undefined} target="_blank" rel="noreferrer" className="text-left font-medium hover:text-primary hover:underline">{j.title}</a>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {j.workMode && <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{j.workMode}</span>}
                          {j.employmentType && <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{j.employmentType}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2"><CompanyLogo text={j.companyLogoText} seed={j.company} /><span className="line-clamp-1">{j.company}</span></div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {j.location ? <span className="inline-flex items-center gap-1"><MapPin className="size-3 opacity-60" />{j.location}</span> : "—"}
                      </td>
                      <td className="px-3 py-2"><SourceBadge source={j.source} /></td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{j.salary ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{postedLabel(j)}</td>
                      <td className="px-2 py-2">
                        {j.url && (
                          <a href={j.url} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100" aria-label="Open role">
                            <ExternalLink className="size-4" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
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
      </div>
    </div>
  );
}

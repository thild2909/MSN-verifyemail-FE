"use client";
import { JobPicker } from "./job-picker";
import { Briefcase as PickerJobsIcon, Radar as RadarGlyph } from "lucide-react";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Radar, Trash2, Loader2, Briefcase, Building2, Ban, Layers, RotateCw, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatNumber, formatDate, cn } from "@/lib/utils";
import { getJobSearches, getJobSearch, deleteJobSearch, retryBlockedJobSources, createPeopleJob } from "@/lib/api/client";
import { DEFAULT_JOB_FILTERS, type JobFilters } from "@/lib/leads/types";
import { JOB_SOURCE_LABEL, type JobCollectJob, type JobSourceCoverage } from "@/lib/leads/job-collect-types";
import { WORK_MODE_LABEL } from "./leads-ui";
import { CollectedJobsTable, type FindPeopleFromJobsPayload } from "./collected-jobs-table";
import { JobCrawlDialog, type CrawlSeed } from "./job-crawl-dialog";
import { StatsBar } from "./stats-bar";
import type { CrawledJobsQuery } from "@/lib/api/client";

function countActive(f: JobFilters): number {
  let n = f.titles.length + f.workModes.length + f.employmentTypes.length + f.seniority.length + f.technologies.length + f.companySizes.length + f.hiringSignals.length;
  if (f.country !== "all") n++;
  if (f.postedWithinDays > 0) n++;
  if (f.salaryMin > 0) n++;
  return n;
}

/** Map the (client) filter state onto the crawled-results query. Only the
 *  filters that map onto real crawled fields are applied; the rest still seed
 *  the crawl (titles → keywords, country → location) via the crawl dialog. */
function toQuery(f: JobFilters): Omit<CrawledJobsQuery, "page" | "pageSize" | "search"> {
  return {
    workModes: f.workModes.map((m) => WORK_MODE_LABEL[m]),
    locations: f.country !== "all" ? [f.country] : [],
    postedWithinDays: f.postedWithinDays > 0 ? f.postedWithinDays : undefined,
  };
}

function seedFromFilters(f: JobFilters): CrawlSeed {
  return {
    keywords: f.titles.join(" ").trim() || f.search.trim(),
    location: f.country !== "all" ? f.country : "",
  };
}

export function JobsTab({ onNavigatePeople }: { onNavigatePeople?: (jobId: string) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [filters, setFilters] = React.useState<JobFilters>(DEFAULT_JOB_FILTERS);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [crawlOpen, setCrawlOpen] = React.useState(false);

  const { data: jobs } = useQuery({
    queryKey: ["job-searches"],
    queryFn: getJobSearches,
    refetchInterval: (q) => (q.state.data as JobCollectJob[] | undefined)?.some((j) => j.status === "collecting") ? 2000 : false,
  });

  React.useEffect(() => { if (!activeId && jobs && jobs.length) setActiveId(jobs[0].id); }, [jobs, activeId]);

  const { data: active } = useQuery({
    queryKey: ["job-search", activeId],
    queryFn: () => getJobSearch(activeId!),
    enabled: !!activeId,
    refetchInterval: (q) => ((q.state.data as JobCollectJob | undefined)?.status === "collecting" ? 1500 : false),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteJobSearch(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["job-searches"] }); setActiveId(null); toast({ variant: "success", title: "Crawl deleted" }); },
    onError: () => toast({ variant: "error", title: "Could not delete" }),
  });

  // "Retry blocked" — re-crawl only the sources that came back blocked/failed
  // (e.g. a Cloudflare wall) without touching the boards that already returned.
  const retry = useMutation({
    mutationFn: (id: string) => retryBlockedJobSources(id),
    onSuccess: ({ sources }) => {
      qc.invalidateQueries({ queryKey: ["job-search", activeId] });
      qc.invalidateQueries({ queryKey: ["job-searches"] });
      toast({ variant: "success", title: "Retrying…", description: `Re-crawling ${sources.length} source${sources.length === 1 ? "" : "s"}.` });
    },
    onError: (e) => toast({ variant: "error", title: "Couldn't retry", description: e instanceof Error ? e.message : "Try again." }),
  });

  // "Find people" — seed a real people-collect job from the employers behind the
  // selected roles (deduped by company name). Opt-in, user-triggered from the
  // selection bar, mirroring the Companies tab. Then jump to the People tab.
  const findPeople = useMutation({
    mutationFn: (payload: FindPeopleFromJobsPayload) =>
      createPeopleJob({ name: `People from ${active?.name ?? "Jobs"}`, seeds: payload.seeds }),
    onSuccess: ({ job, truncated }, payload) => {
      qc.invalidateQueries({ queryKey: ["people-jobs"] });
      toast({
        variant: "success",
        title: "Finding people…",
        description: `Crawling founders & C-level for ${formatNumber(payload.count)} ${payload.count === 1 ? "employer" : "employers"}.${truncated ? ` ${formatNumber(truncated)} skipped (cap 500).` : ""}`,
      });
      onNavigatePeople?.(job.id);
    },
    onError: (e) => toast({ variant: "error", title: "Couldn't start", description: e instanceof Error ? e.message : "Try again." }),
  });

  const patch = (p: Partial<JobFilters>) => setFilters((f) => ({ ...f, ...p }));
  const clear = () => setFilters(DEFAULT_JOB_FILTERS);

  const live = active?.status === "collecting";
  const s = active?.summary;
  const retryable = active?.coverage?.filter((c) => c.status === "blocked" || c.status === "failed").length ?? 0;

  const modals = (
    <>
      <JobCrawlDialog
        open={crawlOpen}
        onOpenChange={setCrawlOpen}
        seed={seedFromFilters(filters)}
        onCreated={(id) => { qc.invalidateQueries({ queryKey: ["job-searches"] }); setActiveId(id); }}
      />
    </>
  );

  if (!jobs || jobs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-4 sm:p-8">
        <EmptyState
          className="w-full max-w-xl"
          icon={Briefcase}
          title="Track hiring signals from the job boards"
          description="Pick your filters and search the job boards (Seek, Indeed, Reed, Dice, Glassdoor, Wellfound and more) for matching open roles. Every role shows the source it came from."
          action={
            <div className="flex items-center gap-2">
              <Button onClick={() => setCrawlOpen(true)}><Radar /> Crawl job boards</Button>
            </div>
          }
        />
        {modals}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2.5 sm:px-6">
        <div className="flex w-full items-center gap-2 sm:contents">
          <JobPicker
            jobs={jobs.map((j) => ({ id: j.id, name: j.name, createdAt: j.createdAt, status: j.status, progress: j.progress, count: { n: j.summary.jobs, unit: "roles" } }))}
            value={activeId}
            onChange={setActiveId}
            icon={PickerJobsIcon}
            label="Job board crawls"
            className="min-w-0 flex-1 sm:w-72 sm:flex-none"
            footer={(close) => (
              <button type="button" onClick={() => { close(); setCrawlOpen(true); }} className="flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium text-brand transition-colors hover:bg-brand/10">
                <RadarGlyph className="size-4" /> New crawl
              </button>
            )}
          />
          {/* Mobile-only compact actions */}
          <div className="flex items-center gap-1.5 sm:hidden">
            <Button size="icon" className="shrink-0" onClick={() => setCrawlOpen(true)} aria-label="New crawl"><Radar /></Button>
            {active && (
              <DropdownMenu align="end" trigger={<Button size="icon" variant="outline" className="shrink-0" aria-label="Actions"><MoreHorizontal /></Button>}>
                {retryable > 0 && !live && <DropdownItem disabled={retry.isPending} onClick={() => retry.mutate(active.id)}><RotateCw /> Retry blocked ({retryable})</DropdownItem>}
                <DropdownItem destructive onClick={async () => { if (await confirm({ title: "Delete crawl?", description: `“${active.name}” and its ${formatNumber(active.summary.jobs)} roles will be permanently removed. This can’t be undone.` })) remove.mutate(active.id); }}><Trash2 /> Delete crawl</DropdownItem>
              </DropdownMenu>
            )}
          </div>
        </div>
        {active && (
          <span className="hidden min-w-0 max-w-md items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-xs text-muted-foreground sm:inline-flex">
            {live && <span className="inline-flex items-center gap-1 rounded bg-brand/10 px-1 text-[10px] font-semibold text-brand"><span className="size-1.5 animate-pulse rounded-full bg-brand" /> Live</span>}
            <span className="font-semibold tabular-nums text-foreground">{formatNumber(active.summary.jobs)}</span> roles
            <span className="text-border">·</span>
            <span className="truncate">{active.sources.map((x) => JOB_SOURCE_LABEL[x]).join(", ")}</span>
          </span>
        )}
        {/* Desktop inline actions */}
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          {active && retryable > 0 && !live && (
            <Button size="sm" variant="outline" onClick={() => retry.mutate(active.id)} disabled={retry.isPending}>
              {retry.isPending ? <Loader2 className="animate-spin" /> : <RotateCw className="text-[hsl(var(--risky))]" />} Retry blocked
              <span className="rounded bg-[hsl(var(--risky)/0.14)] px-1 text-[10px] font-semibold tabular-nums text-[hsl(var(--risky))]">{retryable}</span>
            </Button>
          )}
          {active && retryable > 0 && !live && <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />}
          <Button size="sm" onClick={() => setCrawlOpen(true)}><Radar /> New crawl</Button>
          {active && (
            <Button
              size="icon"
              variant="ghost"
              onClick={async () => { if (await confirm({ title: "Delete crawl?", description: `“${active.name}” and its ${formatNumber(active.summary.jobs)} roles will be permanently removed. This can’t be undone.` })) remove.mutate(active.id); }}
              className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Delete crawl"
            >
              {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      {s && (
        <StatsBar live={!!live} summary={`${formatNumber(s.jobs)} roles · ${formatNumber(s.sourcesDone)}/${formatNumber(s.sources)} sources`}>
          <Stat icon={Briefcase} label="Roles" value={formatNumber(s.jobs)} />
          <Stat icon={Layers} label="Sources" value={`${formatNumber(s.sourcesDone)}/${formatNumber(s.sources)}`} />
          <Stat icon={Building2} label="Employers" value={formatNumber(s.companies)} />
          <Stat icon={RotateCw} label="Pages" value={formatNumber(s.pagesCrawled)} />
          {s.blocked > 0 && <Stat icon={Ban} label="Blocked" value={formatNumber(s.blocked)} tone="risky" />}
          {live && (
            <div className="flex min-w-[160px] flex-1 items-center gap-2">
              <Progress value={active.progress} className="h-1.5 flex-1" indicatorClassName="bg-brand" /><span className="text-xs font-medium tabular-nums text-brand">{active.progress}%</span>
            </div>
          )}
        </StatsBar>
      )}

      {/* Per-source coverage */}
      {active?.coverage && active.coverage.length > 0 && (
        <div className="scroll-rail flex items-center gap-1.5 scrollbar-thin border-b border-border bg-surface/50 px-4 py-2 text-xs sm:px-6 [&>*]:shrink-0 md:flex-wrap md:overflow-visible">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Coverage</span>
          {active.coverage.map((c) => <CoverageChip key={c.source} c={c} />)}
        </div>
      )}

      {/* Body — the table owns its filter sidebar + toolbar, matching the
          People / Companies tabs. */}
      {activeId && (
        <CollectedJobsTable
          jobId={activeId}
          live={!!live}
          query={toQuery(filters)}
          filters={filters}
          onChangeFilters={patch}
          onClearFilters={clear}
          activeFilterCount={countActive(filters)}
          onFindPeople={(payload) => findPeople.mutate(payload)}
          findingPeople={findPeople.isPending}
        />
      )}

      {modals}
    </div>
  );
}

const COVERAGE_META: Record<JobSourceCoverage["status"], { className: string; label: (c: JobSourceCoverage) => string; spin?: boolean }> = {
  pending: { className: "border-border bg-card text-muted-foreground", label: () => "queued" },
  collecting: { className: "border-brand/25 bg-brand/[0.06] text-brand", label: () => "crawling…", spin: true },
  done: { className: "border-[hsl(var(--valid)/0.25)] bg-[hsl(var(--valid)/0.1)] text-[hsl(var(--valid))]", label: (c) => `${c.jobsFound} found` },
  blocked: { className: "border-[hsl(var(--risky)/0.3)] bg-[hsl(var(--risky)/0.12)] text-[hsl(var(--risky))]", label: (c) => (c.jobsFound ? `${c.jobsFound} · blocked` : "blocked") },
  failed: { className: "border-[hsl(var(--invalid)/0.25)] bg-[hsl(var(--invalid)/0.1)] text-[hsl(var(--invalid))]", label: () => "failed" },
};

function CoverageChip({ c }: { c: JobSourceCoverage }) {
  const m = COVERAGE_META[c.status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium", m.className)}>
      {m.spin ? <Loader2 className="size-3 animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
      <span className="font-semibold">{JOB_SOURCE_LABEL[c.source]}</span>
      <span className="opacity-80">· {m.label(c)}</span>
    </span>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: string; tone?: "risky" }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card py-1 pl-1 pr-2.5 shadow-xs">
      <Icon
        className={cn("box-content size-3.5 rounded-md p-1.5", tone === "risky" ? "bg-[hsl(var(--risky)/0.14)] text-[hsl(var(--risky))]" : "bg-surface text-muted-foreground")}
        strokeWidth={1.75}
      />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", tone === "risky" && "text-[hsl(var(--risky))]")}>{value}</span>
    </div>
  );
}

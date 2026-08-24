"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Radar, Trash2, Loader2, Server, ShieldCheck, ShieldOff, Globe, Briefcase, Building2, Ban, Layers, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatNumber, formatDate, cn } from "@/lib/utils";
import { getJobSearches, getJobSearch, deleteJobSearch, getProxyConfig, createPeopleJob } from "@/lib/api/client";
import { DEFAULT_JOB_FILTERS, type JobFilters } from "@/lib/leads/types";
import { JOB_SOURCE_LABEL, type JobCollectJob, type JobSourceCoverage } from "@/lib/leads/job-collect-types";
import { WORK_MODE_LABEL } from "./leads-ui";
import { CollectedJobsTable, type FindPeopleFromJobsPayload } from "./collected-jobs-table";
import { JobCrawlDialog, type CrawlSeed } from "./job-crawl-dialog";
import { ProxySettings } from "./proxy-settings";
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
  const [filters, setFilters] = React.useState<JobFilters>(DEFAULT_JOB_FILTERS);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [crawlOpen, setCrawlOpen] = React.useState(false);
  const [proxyOpen, setProxyOpen] = React.useState(false);

  const { data: jobs } = useQuery({
    queryKey: ["job-searches"],
    queryFn: getJobSearches,
    refetchInterval: (q) => (q.state.data as JobCollectJob[] | undefined)?.some((j) => j.status === "collecting") ? 2000 : false,
  });
  const { data: proxy } = useQuery({ queryKey: ["proxy-config"], queryFn: getProxyConfig });

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

  // "Find people" — seed a real people-collect job from the employers behind the
  // selected roles (deduped by company name). Opt-in, user-triggered from the
  // selection bar, mirroring the Companies tab. Then jump to the People tab.
  const findPeople = useMutation({
    mutationFn: (payload: FindPeopleFromJobsPayload) =>
      createPeopleJob({ name: `${active?.name ?? "Jobs"} — people`, seeds: payload.seeds }),
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

  const enabledProxies = proxy?.proxies.filter((p) => p.enabled).length ?? 0;
  const rotatingActive = proxy?.rotating?.active ?? false;
  const live = active?.status === "collecting";
  const s = active?.summary;

  const modals = (
    <>
      <JobCrawlDialog
        open={crawlOpen}
        onOpenChange={setCrawlOpen}
        seed={seedFromFilters(filters)}
        onCreated={(id) => { qc.invalidateQueries({ queryKey: ["job-searches"] }); setActiveId(id); }}
      />
      <ProxySettings open={proxyOpen} onOpenChange={(o) => { setProxyOpen(o); if (!o) qc.invalidateQueries({ queryKey: ["proxy-config"] }); }} />
    </>
  );

  if (!jobs || jobs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <EmptyState
          icon={Briefcase}
          title="Track hiring signals — live from the job boards"
          description="Pick your filters, then crawl the job boards — Seek, Indeed, Reed, Dice, CTgoodjobs, Foundit, Glassdoor, MyCareersFuture, Wellfound and more — for matching open roles through your proxy pool. Every role is tagged with the source it came from."
          action={
            <div className="flex items-center gap-2">
              <Button onClick={() => setCrawlOpen(true)}><Radar className="size-4" /> Crawl job boards</Button>
              <Button variant="outline" onClick={() => setProxyOpen(true)}><Server className="size-4" /> Proxy settings</Button>
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
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 md:py-2.5">
        <Select value={activeId ?? ""} onChange={(e) => setActiveId(e.target.value)} className="h-9 w-full sm:w-64">
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.name} · {formatDate(j.createdAt)}</option>)}
        </Select>
        {active && <span className="text-xs text-muted-foreground">{formatNumber(active.summary.jobs)} roles · {active.sources.map((x) => JOB_SOURCE_LABEL[x]).join(", ")}</span>}
        <div className="ml-auto flex max-w-full items-center gap-2 overflow-x-auto scrollbar-thin [&>*]:shrink-0 sm:overflow-visible">
          <button onClick={() => setProxyOpen(true)} className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted", rotatingActive || proxy?.enabled ? "border-[hsl(var(--valid))]/40 text-[hsl(var(--valid))]" : "border-input text-muted-foreground")}>
            {rotatingActive ? <Globe className="size-3.5" /> : proxy?.enabled ? <ShieldCheck className="size-3.5" /> : <ShieldOff className="size-3.5" />}
            {rotatingActive ? "Rotating residential" : proxy?.enabled ? `Proxies on · ${enabledProxies}` : "Proxies off"}
          </button>
          <Button size="sm" onClick={() => setCrawlOpen(true)}><Radar className="size-4" /> New crawl</Button>
          {active && <button onClick={() => remove.mutate(active.id)} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-[hsl(var(--invalid))]" aria-label="Delete crawl">{remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}</button>}
        </div>
      </div>

      {/* Stats */}
      {s && (
        <StatsBar live={!!live} summary={`${formatNumber(s.jobs)} roles · ${formatNumber(s.sourcesDone)}/${formatNumber(s.sources)} sources`}>
          <Stat icon={Briefcase} label="Roles" value={formatNumber(s.jobs)} />
          <Stat icon={Layers} label="Sources" value={`${formatNumber(s.sourcesDone)}/${formatNumber(s.sources)}`} />
          <Stat icon={Building2} label="Employers" value={formatNumber(s.companies)} />
          <Stat icon={RotateCw} label="Pages" value={formatNumber(s.pagesCrawled)} />
          <Stat icon={RotateCw} label="Proxy rotations" value={formatNumber(s.proxyRotations)} />
          {s.blocked > 0 && <Stat icon={Ban} label="Blocked" value={formatNumber(s.blocked)} tone="risky" />}
          {live && (
            <div className="flex min-w-[160px] flex-1 items-center gap-2">
              <Progress value={active.progress} className="flex-1" /><span className="tabular-nums text-muted-foreground">{active.progress}%</span>
            </div>
          )}
        </StatsBar>
      )}

      {/* Per-source coverage */}
      {active?.coverage && active.coverage.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin border-b bg-muted/10 px-4 py-2 text-xs [&>*]:shrink-0 md:flex-wrap md:overflow-visible">
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
  pending: { className: "bg-muted text-muted-foreground", label: () => "queued" },
  collecting: { className: "bg-muted text-muted-foreground", label: () => "crawling…", spin: true },
  done: { className: "bg-valid/12 text-[hsl(var(--valid))]", label: (c) => `${c.jobsFound} found` },
  blocked: { className: "bg-amber-500/12 text-amber-600 dark:text-amber-400", label: (c) => (c.jobsFound ? `${c.jobsFound} · blocked` : "blocked") },
  failed: { className: "bg-invalid/12 text-[hsl(var(--invalid))]", label: () => "failed" },
};

function CoverageChip({ c }: { c: JobSourceCoverage }) {
  const m = COVERAGE_META[c.status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium", m.className)}>
      {m.spin && <Loader2 className="size-3 animate-spin" />}
      {JOB_SOURCE_LABEL[c.source]} · {m.label(c)}
    </span>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: string; tone?: "risky" }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={cn("size-3.5", tone === "risky" ? "text-[hsl(var(--risky))]" : "text-muted-foreground")} />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", tone === "risky" && "text-[hsl(var(--risky))]")}>{value}</span>
    </div>
  );
}

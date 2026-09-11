"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Radar, Trash2, Loader2, Briefcase, Building2, Ban, Layers, RotateCw, CheckCircle2, Sparkles, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatNumber, formatDate, cn } from "@/lib/utils";
import {
  getLinkedInSearches, getLinkedInSearch, deleteLinkedInSearch, qualifyLinkedInCompanies,
  retryBlockedLinkedInQueries, createPeopleJob,
} from "@/lib/api/client";
import { DEFAULT_LINKEDIN_FILTERS, type LinkedInJobFilters, type LinkedInSearchJob, type LinkedInQueryCoverage } from "@/lib/leads/linkedin-jobs-types";
import { CollectedLinkedInJobsTable, type FindPeopleFromLinkedInPayload } from "./collected-linkedin-jobs-table";
import { LinkedInJobsCrawlDialog } from "./linkedin-jobs-crawl-dialog";
import { ProxyDialog } from "./proxy-dialog";
import { StatsBar } from "./stats-bar";

export function LinkedInJobsTab({ onNavigatePeople }: { onNavigatePeople?: (jobId: string) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filters, setFilters] = React.useState<LinkedInJobFilters>(DEFAULT_LINKEDIN_FILTERS);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [crawlOpen, setCrawlOpen] = React.useState(false);
  const [proxyOpen, setProxyOpen] = React.useState(false);

  const { data: jobs } = useQuery({
    queryKey: ["linkedin-searches"],
    queryFn: getLinkedInSearches,
    refetchInterval: (q) => (q.state.data as LinkedInSearchJob[] | undefined)?.some((j) => j.status === "collecting" || j.enrichStatus === "enriching") ? 2000 : false,
  });

  React.useEffect(() => { if (!activeId && jobs && jobs.length) setActiveId(jobs[0].id); }, [jobs, activeId]);

  const { data: active } = useQuery({
    queryKey: ["linkedin-search", activeId],
    queryFn: () => getLinkedInSearch(activeId!),
    enabled: !!activeId,
    refetchInterval: (q) => { const j = q.state.data as LinkedInSearchJob | undefined; return j && (j.status === "collecting" || j.enrichStatus === "enriching") ? 1500 : false; },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteLinkedInSearch(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["linkedin-searches"] }); setActiveId(null); toast({ variant: "success", title: "Scrape deleted" }); },
    onError: () => toast({ variant: "error", title: "Could not delete" }),
  });

  const retry = useMutation({
    mutationFn: (id: string) => retryBlockedLinkedInQueries(id),
    onSuccess: ({ queries }) => {
      qc.invalidateQueries({ queryKey: ["linkedin-search", activeId] });
      qc.invalidateQueries({ queryKey: ["linkedin-searches"] });
      toast({ variant: "success", title: "Retrying…", description: `Re-crawling ${queries.length} quer${queries.length === 1 ? "y" : "ies"}.` });
    },
    onError: (e) => toast({ variant: "error", title: "Couldn't retry", description: e instanceof Error ? e.message : "Try again." }),
  });

  // Opt-in "Qualify companies": fetch job detail + scrape company pages for
  // employee count / industry, then re-qualify + re-score. User-triggered
  // because it's the expensive per-company step (opt-in-expensive-ops).
  const qualify = useMutation({
    mutationFn: (id: string) => qualifyLinkedInCompanies(id),
    onSuccess: ({ targets }) => {
      qc.invalidateQueries({ queryKey: ["linkedin-search", activeId] });
      toast({ variant: "success", title: "Qualifying companies…", description: `Enriching ${formatNumber(targets)} qualified role${targets === 1 ? "" : "s"} (job detail + company page).` });
    },
    onError: (e) => toast({ variant: "error", title: "Couldn't qualify", description: e instanceof Error ? e.message : "Try again." }),
  });

  const findPeople = useMutation({
    mutationFn: (payload: FindPeopleFromLinkedInPayload) =>
      createPeopleJob({ name: `People from ${active?.name ?? "LinkedIn"}`, seeds: payload.seeds }),
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

  const patch = (p: Partial<LinkedInJobFilters>) => setFilters((f) => ({ ...f, ...p }));
  const clear = () => setFilters(DEFAULT_LINKEDIN_FILTERS);

  const live = active?.status === "collecting";
  const enriching = active?.enrichStatus === "enriching";
  const s = active?.summary;
  const retryable = active?.coverage?.filter((c) => c.status === "blocked" || c.status === "failed").length ?? 0;
  const canQualify = !!active && !live && !enriching && (s ? s.qualified > s.enriched : false);

  const modals = (
    <>
      <LinkedInJobsCrawlDialog
        open={crawlOpen}
        onOpenChange={setCrawlOpen}
        onCreated={(id) => { qc.invalidateQueries({ queryKey: ["linkedin-searches"] }); setActiveId(id); }}
      />
      <ProxyDialog open={proxyOpen} onOpenChange={setProxyOpen} />
    </>
  );

  if (!jobs || jobs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <EmptyState
          icon={Briefcase}
          title="Scrape hiring companies from LinkedIn"
          description="Discover open technical roles from LinkedIn's public job search, normalize and dedupe them, then qualify the hiring companies by size & industry — turning job posts into leads."
          action={
            <div className="flex items-center gap-2">
              <Button onClick={() => setCrawlOpen(true)}><Radar className="size-4" /> Scrape LinkedIn jobs</Button>
              <Button variant="outline" onClick={() => setProxyOpen(true)}><Shuffle className="size-4" /> Proxy</Button>
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
        {active && <span className="text-xs text-muted-foreground">{formatNumber(active.summary.qualified)} qualified · {formatNumber(active.summary.jobs)} roles</span>}
        <div className="ml-auto flex max-w-full items-center gap-2 overflow-x-auto scrollbar-thin [&>*]:shrink-0 sm:overflow-visible">
          {canQualify && (
            <Button size="sm" variant="outline" onClick={() => qualify.mutate(active!.id)} disabled={qualify.isPending}>
              {qualify.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Qualify companies
            </Button>
          )}
          {enriching && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Qualifying…</span>}
          {active && retryable > 0 && !live && (
            <Button size="sm" variant="outline" onClick={() => retry.mutate(active.id)} disabled={retry.isPending}>
              {retry.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />} Retry blocked
              <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 tabular-nums">{retryable}</span>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setProxyOpen(true)}><Shuffle className="size-4" /> Proxy</Button>
          <Button size="sm" onClick={() => setCrawlOpen(true)}><Radar className="size-4" /> New scrape</Button>
          {active && <button onClick={() => remove.mutate(active.id)} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-[hsl(var(--invalid))]" aria-label="Delete scrape">{remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}</button>}
        </div>
      </div>

      {/* Stats */}
      {s && (
        <StatsBar live={!!live || enriching} summary={`${formatNumber(s.qualified)} qualified · ${formatNumber(s.jobs)} roles`}>
          <Stat icon={CheckCircle2} label="Qualified" value={formatNumber(s.qualified)} />
          <Stat icon={Briefcase} label="Roles" value={formatNumber(s.jobs)} />
          <Stat icon={Building2} label="Companies" value={formatNumber(s.companies)} />
          <Stat icon={Sparkles} label="Enriched" value={formatNumber(s.enriched)} />
          <Stat icon={Layers} label="Queries" value={`${formatNumber(s.queriesDone)}/${formatNumber(s.queries)}`} />
          {s.blocked > 0 && <Stat icon={Ban} label="Blocked" value={formatNumber(s.blocked)} tone="risky" />}
          {(live || enriching) && (
            <div className="flex min-w-[160px] flex-1 items-center gap-2">
              <Progress value={live ? active!.progress : 100} className="flex-1" /><span className="tabular-nums text-muted-foreground">{live ? `${active!.progress}%` : "enriching…"}</span>
            </div>
          )}
        </StatsBar>
      )}

      {/* Per-query coverage */}
      {active?.coverage && active.coverage.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin border-b bg-muted/10 px-4 py-2 text-xs [&>*]:shrink-0 md:flex-wrap md:overflow-visible">
          {active.coverage.map((c) => <CoverageChip key={c.key} c={c} />)}
        </div>
      )}

      {activeId && (
        <CollectedLinkedInJobsTable
          jobId={activeId}
          live={!!live || enriching}
          filters={filters}
          onChangeFilters={patch}
          onClearFilters={clear}
          onFindPeople={(payload) => findPeople.mutate(payload)}
          findingPeople={findPeople.isPending}
        />
      )}

      {modals}
    </div>
  );
}

const COVERAGE_META: Record<LinkedInQueryCoverage["status"], { className: string; label: (c: LinkedInQueryCoverage) => string; spin?: boolean }> = {
  pending: { className: "bg-muted text-muted-foreground", label: () => "queued" },
  collecting: { className: "bg-muted text-muted-foreground", label: () => "scraping…", spin: true },
  done: { className: "bg-valid/12 text-[hsl(var(--valid))]", label: (c) => `${c.jobsFound} found` },
  blocked: { className: "bg-amber-500/12 text-amber-600 dark:text-amber-400", label: (c) => (c.jobsFound ? `${c.jobsFound} · blocked` : "blocked") },
  failed: { className: "bg-invalid/12 text-[hsl(var(--invalid))]", label: () => "failed" },
};

function CoverageChip({ c }: { c: LinkedInQueryCoverage }) {
  const m = COVERAGE_META[c.status];
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium", m.className)}
      title={c.error ? `${c.key}: ${c.error}` : c.key}
    >
      {m.spin && <Loader2 className="size-3 animate-spin" />}
      {c.key} · {m.label(c)}
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

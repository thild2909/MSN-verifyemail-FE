"use client";
import { JobPicker } from "./job-picker";
import { Linkedin as PickerLinkedInIcon, Radar as RadarGlyph } from "lucide-react";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Radar, Trash2, Loader2, Briefcase, Building2, Ban, Layers, RotateCw, CheckCircle2, Sparkles, Shuffle, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatNumber, formatDate, cn } from "@/lib/utils";
import { IconTile } from "@/components/common/kit";
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
  const confirm = useConfirm();
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
      toast({ variant: "success", title: "Qualifying companies…", description: `Verifying ${formatNumber(targets)} role${targets === 1 ? "" : "s"} (job detail + company page).` });
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
  // Older saved summaries lack `pending` — fall back to the legacy qualified-but-unenriched count.
  const pending = s ? (s.pending ?? Math.max(0, s.qualified - s.enriched)) : 0;
  const canQualify = !!active && !live && !enriching && pending > 0;
  const enrichPct = s && s.enriched + pending > 0 ? Math.round((s.enriched / (s.enriched + pending)) * 100) : 100;

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
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-8">
        <EmptyState
          icon={Briefcase}
          title="Scrape hiring companies from LinkedIn"
          description="Discover open technical roles from LinkedIn's public job search, normalize and dedupe them, then qualify the hiring companies by size & industry — turning job posts into leads."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="brand" onClick={() => setCrawlOpen(true)}><Radar className="size-4" /> Scrape LinkedIn jobs</Button>
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
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2.5 sm:px-6">
        <div className="flex w-full items-center gap-2 sm:contents">
          <JobPicker
            jobs={jobs.map((j) => ({ id: j.id, name: j.name, createdAt: j.createdAt, status: j.status, progress: j.progress, count: { n: j.summary.jobs, unit: "roles" } }))}
            value={activeId}
            onChange={setActiveId}
            icon={PickerLinkedInIcon}
            label="LinkedIn scrapes"
            className="min-w-0 flex-1 sm:w-72 sm:flex-none"
            footer={(close) => (
              <button type="button" onClick={() => { close(); setCrawlOpen(true); }} className="flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium text-brand transition-colors hover:bg-brand/10">
                <RadarGlyph className="size-4" /> New scrape
              </button>
            )}
          />
          {/* Mobile-only compact actions */}
          <div className="flex items-center gap-1.5 sm:hidden">
            <Button size="icon" variant="brand" className="size-9 shrink-0" onClick={() => setCrawlOpen(true)} aria-label="New scrape"><Radar className="size-4" /></Button>
            <DropdownMenu align="end" trigger={<Button size="icon" variant="outline" className="size-9 shrink-0" aria-label="Actions"><MoreHorizontal className="size-4" /></Button>}>
              {canQualify && <DropdownItem disabled={qualify.isPending} onClick={() => qualify.mutate(active!.id)}><Sparkles /> Qualify companies</DropdownItem>}
              {active && retryable > 0 && !live && <DropdownItem disabled={retry.isPending} onClick={() => retry.mutate(active.id)}><RotateCw /> Retry blocked ({retryable})</DropdownItem>}
              <DropdownItem onClick={() => setProxyOpen(true)}><Shuffle /> Proxy</DropdownItem>
              {active && (
                <>
                  <DropdownSeparator />
                  <DropdownItem destructive onClick={async () => { if (await confirm({ title: "Delete scrape?", description: `“${active.name}” and its ${formatNumber(active.summary.jobs)} roles will be permanently removed. This can’t be undone.` })) remove.mutate(active.id); }}><Trash2 /> Delete scrape</DropdownItem>
                </>
              )}
            </DropdownMenu>
          </div>
        </div>
        {active && (
          <span className="hidden items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-xs text-muted-foreground sm:inline-flex">
            {live ? <span className="inline-flex items-center gap-1 rounded bg-brand/10 px-1 text-[10px] font-semibold text-brand"><span className="size-1.5 animate-pulse rounded-full bg-brand" /> Live</span> : <span className="size-1.5 rounded-full bg-[hsl(var(--valid))]" />}
            <span className="font-semibold tabular-nums text-foreground">{formatNumber(active.summary.qualified)}</span> qualified · <span className="font-semibold tabular-nums text-foreground">{formatNumber(active.summary.jobs)}</span> roles
          </span>
        )}
        {/* Desktop inline actions */}
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          {canQualify && (
            <Button size="sm" variant="brand" onClick={() => qualify.mutate(active!.id)} disabled={qualify.isPending} title="Fetch details and scrape company pages for the qualified roles.">
              {qualify.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Qualify companies
              <span className="rounded bg-brand/10 px-1 text-[10px] font-semibold tabular-nums">{formatNumber(pending)}</span>
            </Button>
          )}
          {enriching && <span className="inline-flex items-center gap-1.5 rounded-md bg-brand/10 px-2 py-1 text-xs font-medium text-brand"><Loader2 className="size-3.5 animate-spin" /> Qualifying…</span>}
          {active && retryable > 0 && !live && (
            <Button size="sm" variant="outline" onClick={() => retry.mutate(active.id)} disabled={retry.isPending}>
              {retry.isPending ? <Loader2 className="animate-spin" /> : <RotateCw className="text-[hsl(var(--risky))]" />} Retry blocked
              <span className="rounded bg-[hsl(var(--risky)/0.14)] px-1 text-[10px] font-semibold tabular-nums text-[hsl(var(--risky))]">{retryable}</span>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setProxyOpen(true)}><Shuffle className="text-[hsl(199_89%_40%)] dark:text-[hsl(199_90%_65%)]" /> Proxy</Button>
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
          <Button size="sm" onClick={() => setCrawlOpen(true)}><Radar /> New scrape</Button>
          {active && (
            <Button
              size="icon"
              variant="ghost"
              className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={async () => { if (await confirm({ title: "Delete scrape?", description: `“${active.name}” and its ${formatNumber(active.summary.jobs)} roles will be permanently removed. This can’t be undone.` })) remove.mutate(active.id); }}
              aria-label="Delete scrape"
              title="Delete scrape"
            >
              {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
            </Button>
          )}
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
              <Progress value={live ? active!.progress : enrichPct} className="flex-1" /><span className="text-xs font-medium tabular-nums text-muted-foreground">{live ? `${active!.progress}%` : `${formatNumber(s.enriched)}/${formatNumber(s.enriched + pending)} verified`}</span>
            </div>
          )}
        </StatsBar>
      )}

      {/* Per-query coverage */}
      {active?.coverage && active.coverage.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin border-b border-border bg-surface/40 px-4 py-2 text-[11px] sm:px-6 [&>*]:shrink-0 md:flex-wrap md:overflow-visible">
          <span className="mr-0.5 font-semibold uppercase tracking-wider text-muted-foreground">Queries</span>
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

/** "2,871 / 3,000+ found" — progress against LinkedIn's reported total. */
function ofTotal(c: LinkedInQueryCoverage) {
  return `${formatNumber(c.jobsFound)} / ${formatNumber(c.total ?? 0)}${c.totalCapped ? "+" : ""} found`;
}

const COVERAGE_META: Record<LinkedInQueryCoverage["status"], { className: string; label: (c: LinkedInQueryCoverage) => string; spin?: boolean }> = {
  pending: { className: "bg-card text-muted-foreground ring-1 ring-inset ring-border", label: () => "queued" },
  collecting: { className: "bg-brand/10 text-brand", label: (c) => (c.total != null ? `${ofTotal(c)}${c.slices ? ` · slice ${c.slices}` : ""}…` : "scraping…"), spin: true },
  done: { className: "bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]", label: (c) => (c.total != null ? ofTotal(c) : `${c.jobsFound} found`) },
  blocked: { className: "bg-[hsl(var(--risky)/0.14)] text-[hsl(var(--risky))]", label: (c) => (c.jobsFound ? `${c.jobsFound} · blocked` : "blocked") },
  failed: { className: "bg-[hsl(var(--invalid)/0.1)] text-[hsl(var(--invalid))]", label: () => "failed" },
};

function CoverageChip({ c }: { c: LinkedInQueryCoverage }) {
  const m = COVERAGE_META[c.status];
  return (
    <span
      className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 font-semibold", m.className)}
      title={c.error ? `${c.key}: ${c.error}` : c.key}
    >
      {m.spin && <Loader2 className="size-3 animate-spin" />}
      {c.key} · {m.label(c)}
    </span>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: string; tone?: "risky" }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card py-1 pl-1 pr-2.5 shadow-xs">
      <IconTile icon={Icon} tone={tone === "risky" ? "risky" : "muted"} size="sm" className="size-6" />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", tone === "risky" && "text-[hsl(var(--risky))]")}>{value}</span>
    </div>
  );
}

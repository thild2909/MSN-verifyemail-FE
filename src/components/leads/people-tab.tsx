"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Trash2, Loader2, Crown, Building2, Mail, Linkedin, MailCheck, UserSearch, Star, Upload, Sparkles, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatNumber, formatDate, cn } from "@/lib/utils";
import { getPeopleJobs, getPeopleJob, deletePeopleJob, verifyPeopleEmails, llmVerifyPeople, retryPeopleGaps, ApiError } from "@/lib/api/client";
import { CollectedPeopleTable } from "./collected-people-table";
import { PersonDetailDrawer } from "./people-detail-drawer";
import { PeopleImportFlow } from "./people-import-flow";
import { StatsBar } from "./stats-bar";
import type { CollectedPerson, PeopleCollectJob } from "@/lib/leads/people-types";

export function PeopleTab({ initialJobId }: { initialJobId?: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeId, setActiveId] = React.useState<string | null>(initialJobId ?? null);
  const [drawer, setDrawer] = React.useState<CollectedPerson | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);

  const { data: jobs } = useQuery({
    queryKey: ["people-jobs"],
    queryFn: getPeopleJobs,
    refetchInterval: (q) => (q.state.data as PeopleCollectJob[] | undefined)?.some((j) => j.status === "collecting" || j.verifyStatus === "verifying") ? 2000 : false,
  });

  // Jump to a freshly-created job, else default to the newest.
  React.useEffect(() => { if (initialJobId) setActiveId(initialJobId); }, [initialJobId]);
  React.useEffect(() => { if (!activeId && jobs && jobs.length) setActiveId(jobs[0].id); }, [jobs, activeId]);

  const { data: active } = useQuery({
    queryKey: ["people-job", activeId],
    queryFn: () => getPeopleJob(activeId!),
    enabled: !!activeId,
    refetchInterval: (q) => { const j = q.state.data as PeopleCollectJob | undefined; return j?.status === "collecting" || j?.verifyStatus === "verifying" ? 1500 : false; },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deletePeopleJob(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["people-jobs"] }); setActiveId(null); toast({ variant: "success", title: "People search deleted" }); },
    onError: () => toast({ variant: "error", title: "Could not delete" }),
  });

  const verify = useMutation({
    mutationFn: (id: string) => verifyPeopleEmails(id), // incremental: skip rows already looked up
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["people-job", activeId] });
      qc.invalidateQueries({ queryKey: ["collect-people", activeId] });
      toast(r.verified === 0
        ? { variant: "info", title: "Already checked", description: "Every person already has a saved email result. Misses stay Not found." }
        : {
            variant: "success",
            title: r.found ? `Found ${r.found} real email${r.found === 1 ? "" : "s"}` : "Emails verified",
            description: `${r.valid}/${r.verified} deliverable${r.found ? ` · ${r.found} discovered by finder` : ""} · via ${r.provider}`,
          });
    },
    onError: () => toast({ variant: "error", title: "Verification failed" }),
  });

  // "Retry failed" — re-crawl the coverage-gap companies (0 people found).
  const retryGaps = useMutation({
    mutationFn: (id: string) => retryPeopleGaps(id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["people-jobs"] });
      qc.invalidateQueries({ queryKey: ["people-job", activeId] });
      qc.invalidateQueries({ queryKey: ["collect-people", activeId] });
      toast(r.reset
        ? { variant: "success", title: "Retrying coverage gaps", description: `${r.reset} ${r.reset === 1 ? "company" : "companies"} re-queued for a fresh crawl.` }
        : { variant: "info", title: "Nothing to retry", description: "No coverage-gap companies (every company already found people)." });
    },
    onError: () => toast({ variant: "error", title: "Retry failed" }),
  });

  // LLM (DeepSeek) exec-fill for coverage gaps + founder↔company cross-check — opt-in, batched.
  const llmVerify = useMutation({
    mutationFn: (id: string) => llmVerifyPeople(id, false),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["collect-people", activeId] });
      qc.invalidateQueries({ queryKey: ["people-job", activeId] }); // refresh coverage gaps + summary
      const didFill = r.gapCompanies > 0;
      const didAudit = r.checked > 0;
      if (!didFill && !didAudit) {
        toast({ variant: "info", title: "Nothing to verify", description: r.skipped > 0 ? `Skipped ${r.skipped} high-confidence people; no coverage gaps to fill.` : "All people AI-checked and no coverage gaps." });
        return;
      }
      const parts: string[] = [];
      if (didFill) parts.push(`Filled ${r.filled} exec${r.filled === 1 ? "" : "s"} across ${r.gapCompanies} gap ${r.gapCompanies === 1 ? "company" : "companies"} (${r.proposed} proposed · ${r.dropped} unconfirmed)`);
      if (didAudit) parts.push(`Reviewed ${r.checked}: ${r.verified} match · ${r.mismatch} mismatch · ${r.uncertain} uncertain`);
      if (r.corrected) parts.push(`Fixed ${r.corrected} LinkedIn${r.corrected === 1 ? "" : "s"}`);
      if (r.cleared) parts.push(`Removed ${r.cleared} wrong link${r.cleared === 1 ? "" : "s"}`);
      parts.push(`${formatNumber(r.tokens)} tokens`);
      toast({
        variant: r.mismatch > 0 ? "error" : r.filled > 0 || r.verified > 0 ? "success" : "info",
        title: didFill ? `AI added ${r.filled} founder/exec${r.filled === 1 ? "" : "s"}` : `AI reviewed ${r.checked} people`,
        description: parts.join(" · "),
      });
    },
    onError: (e) => toast({ variant: "error", title: "AI verify failed", description: e instanceof ApiError && e.code === "LLM_NOT_CONFIGURED" ? "Set DEEPSEEK_API_KEY in the app env." : "Try again." }),
  });

  const verifying = active?.verifyStatus === "verifying" || verify.isPending;
  const live = active?.status === "collecting" || verifying;
  const s = active?.summary;
  const seedLabel = active?.mode === "enrich" ? "Rows" : "Companies";
  // Coverage-gap companies (discover mode, crawl done, nobody found) that the AI
  // exec-fill can still try — so "AI verify" stays useful even at 0 people.
  const hasCoverageGaps = active?.mode === "discover" &&
    (active.coverage ?? []).some((c) => (c.status === "done" || c.status === "failed") && c.peopleFound === 0);

  const importModal = (
    <PeopleImportFlow
      open={importOpen}
      onOpenChange={setImportOpen}
      onCreated={(id) => { qc.invalidateQueries({ queryKey: ["people-jobs"] }); setActiveId(id); }}
    />
  );

  if (!jobs || jobs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <EmptyState
          icon={UserSearch}
          title="Find decision-makers"
          description="Import a CSV of people (First Name, Last Name, Company Name) to enrich each with LinkedIn + a verifiable email — or go to the Companies tab and click “Find people” to discover a company's founders and C-level."
          action={<Button onClick={() => setImportOpen(true)}><Upload className="size-4" /> Import people</Button>}
        />
        {importModal}
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
        {active && <span className="text-xs text-muted-foreground">{formatNumber(active.summary.people)} people · {formatNumber(active.totalCompanies)} {active.mode === "enrich" ? "rows" : "companies"}</span>}
        <div className="ml-auto flex max-w-full items-center gap-2 overflow-x-auto scrollbar-thin [&>*]:shrink-0 sm:overflow-visible">
          {active && (
            <Button size="sm" variant="outline" onClick={() => verify.mutate(active.id)} disabled={verifying || active.summary.people === 0} title="Find & verify emails that have not been checked yet. Results (including Not found) are saved so the same person is not searched twice.">
              {verifying ? <Loader2 className="size-4 animate-spin" /> : <MailCheck className="size-4" />}
              {verifying ? "Finding…" : "Find & verify"}
            </Button>
          )}
          {active?.mode === "discover" && hasCoverageGaps && (
            <Button size="sm" variant="outline" onClick={() => retryGaps.mutate(active.id)} disabled={retryGaps.isPending || active.status === "collecting"} title="Re-crawl the coverage-gap companies (0 people found) with a fresh search pass.">
              {retryGaps.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
              Retry failed
            </Button>
          )}
          {active && (active.summary.people > 0 || hasCoverageGaps) && (
            <Button size="sm" variant="outline" onClick={() => llmVerify.mutate(active.id)} disabled={llmVerify.isPending} title={hasCoverageGaps ? "Cross-check people and fill coverage-gap companies with AI-proposed executives (each re-verified on the live web)." : "AI cross-check the found people."}>
              {llmVerify.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {llmVerify.isPending ? "Reviewing…" : "AI verify"}
            </Button>
          )}
          <Button size="sm" onClick={() => setImportOpen(true)}><Upload className="size-4" /> Import people</Button>
          {active && <button onClick={() => remove.mutate(active.id)} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-[hsl(var(--invalid))]" aria-label="Delete people search">{remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}</button>}
        </div>
      </div>

      {/* Stats */}
      {s && (
        <StatsBar live={!!live} summary={`${formatNumber(s.people)} people · ${formatNumber(s.withEmail)} emails · ${formatNumber(s.withLinkedin)} LinkedIn`}>
          <Stat icon={Users} label="People" value={formatNumber(s.people)} />
          <Stat icon={Star} label="Founders" value={formatNumber(s.founders)} />
          <Stat icon={Crown} label="C-Level" value={formatNumber(s.cLevel)} />
          <Stat icon={Users} label="VP / Pres" value={formatNumber(s.vps)} />
          <Stat icon={Building2} label={seedLabel} value={`${formatNumber(s.companiesWithPeople)}/${formatNumber(s.companies)}`} />
          <Stat icon={Mail} label="Emails" value={formatNumber(s.withEmail)} />
          <Stat icon={Linkedin} label="LinkedIn" value={formatNumber(s.withLinkedin)} />
          <Stat icon={MailCheck} label="Valid emails" value={`${formatNumber(s.emailsValid)}/${formatNumber(s.emailsVerified)}`} />
          {live && (
            <div className="flex min-w-[160px] flex-1 items-center gap-2">
              {active.verifyStatus === "verifying"
                ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--risky))]"><Loader2 className="size-3.5 animate-spin" /> Verifying emails…</span>
                : <><Progress value={active.progress} className="flex-1" /><span className="tabular-nums text-muted-foreground">{active.progress}%</span></>}
            </div>
          )}
        </StatsBar>
      )}

      {/* Per-company coverage (discover mode): ONLY companies that finished with
          NO people found. Still-processing companies are hidden (they're not a
          confirmed gap yet), and the list is capped + height-limited so a run
          over 1000 companies can't flood the screen — the rest collapse into a
          "+N more" count. Companies that yielded people are in the table below. */}
      {active?.mode === "discover" && (() => {
        const gaps = (active.coverage ?? []).filter((c) =>
          (c.status === "done" || c.status === "failed") && c.peopleFound === 0);
        if (gaps.length === 0) return null;
        const MAX = 60;
        const shown = gaps.slice(0, MAX);
        const extra = gaps.length - shown.length;
        return (
          <div className="flex max-h-24 flex-wrap items-center gap-1.5 overflow-y-auto scrollbar-thin border-b bg-muted/10 px-4 py-2 text-xs [&>*]:shrink-0">
            <span className="mr-1 font-medium text-muted-foreground">Coverage gaps ({formatNumber(gaps.length)}):</span>
            {shown.map((c, i) => (
              <span key={i} title="No decision-makers found on LinkedIn search or the company about/team pages."
                className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-400">
                {c.company.length > 26 ? c.company.slice(0, 26) + "…" : c.company} · 0 found
              </span>
            ))}
            {extra > 0 && <span className="font-medium text-muted-foreground">+{formatNumber(extra)} more</span>}
          </div>
        );
      })()}

      {/* Table */}
      {activeId && (
        <CollectedPeopleTable
          jobId={activeId}
          live={!!live}
          bulkVerifying={verifying}
          verifyingPersonIds={active?.verifyingPersonIds}
          onOpenPerson={setDrawer}
        />
      )}

      <PersonDetailDrawer person={drawer} open={!!drawer} onOpenChange={(o) => !o && setDrawer(null)} />
      {importModal}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={cn("size-3.5 text-muted-foreground")} />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

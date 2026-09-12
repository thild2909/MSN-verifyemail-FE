"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Trash2, Loader2, Crown, Building2, Mail, Linkedin, MailCheck, MailX, UserSearch, Star, Upload, Sparkles, RotateCw, ExternalLink, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatNumber, formatDate, cn } from "@/lib/utils";
import { getPeopleJobs, getPeopleJob, deletePeopleJob, verifyPeopleEmails, retryPeopleNotFound, llmVerifyPeople, retryPeopleGaps, ApiError } from "@/lib/api/client";
import { CollectedPeopleTable } from "./collected-people-table";
import { PersonDetailDrawer } from "./people-detail-drawer";
import { PeopleImportFlow } from "./people-import-flow";
import { StatsBar } from "./stats-bar";
import type { CollectedPerson, PeopleCollectJob } from "@/lib/leads/people-types";

export function PeopleTab({ initialJobId }: { initialJobId?: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
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
    refetchInterval: (q) => { const j = q.state.data as PeopleCollectJob | null | undefined; return j?.status === "collecting" || j?.verifyStatus === "verifying" ? 1500 : false; },
  });

  // The selected job was deleted / no longer exists (query resolved to null):
  // drop the stale id so the effect above re-selects the newest live job.
  React.useEffect(() => { if (activeId && active === null) setActiveId(null); }, [active, activeId]);

  const remove = useMutation({
    mutationFn: (id: string) => deletePeopleJob(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["people-jobs"] }); setActiveId(null); toast({ variant: "success", title: "People search deleted" }); },
    onError: () => toast({ variant: "error", title: "Could not delete" }),
  });

  const verify = useMutation({
    mutationFn: (id: string) => verifyPeopleEmails(id), // incremental: skip rows already looked up
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["people-jobs"] });
      qc.invalidateQueries({ queryKey: ["people-job", activeId] });
      qc.invalidateQueries({ queryKey: ["collect-people", activeId] });
      if (r.alreadyRunning) {
        toast({ variant: "info", title: "Already running", description: "A Find & verify pass is already in progress for this list." });
      } else if (r.pending === 0) {
        toast({ variant: "info", title: "Already checked", description: "Every person already has a saved email result. Misses stay Not found." });
      } else {
        toast({ variant: "success", title: `Finding & verifying ${formatNumber(r.pending)} email${r.pending === 1 ? "" : "s"}`, description: "Running in the background — the table updates live as each person is checked." });
      }
    },
    onError: () => toast({ variant: "error", title: "Verification failed" }),
  });

  // "Retry notfound" — re-open only the misses (Not found) and re-run the same
  // Find & verify pass over just those, keeping every settled address.
  const retryNotFound = useMutation({
    mutationFn: (id: string) => retryPeopleNotFound(id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["people-jobs"] });
      qc.invalidateQueries({ queryKey: ["people-job", activeId] });
      qc.invalidateQueries({ queryKey: ["collect-people", activeId] });
      if (r.alreadyRunning) {
        toast({ variant: "info", title: "Already running", description: "A Find & verify pass is already in progress for this list." });
      } else if (r.pending === 0) {
        toast({ variant: "info", title: "Nothing to retry", description: "No Not found people to re-search." });
      } else {
        toast({ variant: "success", title: `Retrying ${formatNumber(r.pending)} Not found`, description: "Re-searching the misses in the background — the table updates live." });
      }
    },
    onError: () => toast({ variant: "error", title: "Retry failed" }),
  });

  // Toast when a background verify pass finishes (verifying → done) or is
  // interrupted before finishing (verifying → idle, e.g. the engine was down).
  const prevVerify = React.useRef<PeopleCollectJob["verifyStatus"] | undefined>(undefined);
  React.useEffect(() => {
    const vs = active?.verifyStatus;
    if (prevVerify.current === "verifying") {
      if (vs === "done" && active?.summary) {
        const { emailsValid, emailsVerified } = active.summary;
        toast({ variant: "success", title: "Find & verify complete", description: `${formatNumber(emailsValid)} deliverable of ${formatNumber(emailsVerified)} verified.` });
      } else if (vs === "idle") {
        toast({ variant: "error", title: "Verification interrupted", description: "The pass stopped before finishing — the verification engine may be unavailable. Click Find & verify to resume." });
      }
    }
    prevVerify.current = vs;
  }, [active?.verifyStatus, active?.summary, toast]);

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
  // "Retry notfound" targets the "Not found" rows only — people that WERE looked up
  // and came back empty (verdict not_found = summary.emailsNotFound). The separate
  // "Not searched" rows (never looked up) are handled by the normal Find & verify.
  const notFound = s?.emailsNotFound ?? 0;
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
          description="Import a CSV with First Name, Last Name and Company Name. We add each person's LinkedIn and a verified email. You can also use “Find people” on the Companies tab."
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
        {/* Mobile keeps the selector + compact actions on one line (a “⋯” menu
            holds the rest) so the card list keeps the vertical space; sm+ shows
            the full inline toolbar. */}
        <div className="flex w-full items-center gap-2 sm:contents">
          <Select value={activeId ?? ""} onChange={(e) => setActiveId(e.target.value)} className="h-9 min-w-0 flex-1 sm:w-64 sm:flex-none">
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.name} · {formatDate(j.createdAt)}</option>)}
          </Select>
          {/* Mobile-only compact actions */}
          <div className="flex items-center gap-1.5 sm:hidden">
            <Button size="icon" className="size-9 shrink-0" onClick={() => setImportOpen(true)} aria-label="Import people">
              {importOpen ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            </Button>
            <DropdownMenu align="end" trigger={<Button size="icon" variant="outline" className="size-9 shrink-0" aria-label="Actions"><MoreHorizontal className="size-4" /></Button>}>
              {active && (
                <DropdownItem disabled={verifying || active.summary.people === 0} onClick={() => verify.mutate(active.id)}><MailCheck /> Find &amp; verify</DropdownItem>
              )}
              {active && notFound > 0 && (
                <DropdownItem disabled={verifying || retryNotFound.isPending} onClick={() => retryNotFound.mutate(active.id)}><MailX /> Retry notfound ({formatNumber(notFound)})</DropdownItem>
              )}
              {active?.mode === "discover" && hasCoverageGaps && (
                <DropdownItem disabled={retryGaps.isPending || active.status === "collecting"} onClick={() => retryGaps.mutate(active.id)}><RotateCw /> Retry failed</DropdownItem>
              )}
              {active && (active.summary.people > 0 || hasCoverageGaps) && (
                <DropdownItem disabled={llmVerify.isPending} onClick={() => llmVerify.mutate(active.id)}><Sparkles /> AI verify</DropdownItem>
              )}
              {active?.apolloUrl && (
                <DropdownItem onClick={() => window.open(active.apolloUrl!, "_blank", "noopener,noreferrer")}><ExternalLink /> Open Apollo list</DropdownItem>
              )}
              {active && (
                <>
                  <DropdownSeparator />
                  <DropdownItem destructive onClick={async () => { if (await confirm({ title: "Delete people search?", description: `“${active.name}” and its ${formatNumber(active.summary.people)} people will be permanently removed. This can’t be undone.` })) remove.mutate(active.id); }}><Trash2 /> Delete search</DropdownItem>
                </>
              )}
            </DropdownMenu>
          </div>
        </div>
        {active && <span className="hidden text-xs text-muted-foreground sm:inline">{formatNumber(active.summary.people)} people · {formatNumber(active.totalCompanies)} {active.mode === "enrich" ? "rows" : "companies"}</span>}
        {active?.apolloUrl && (
          <a href={active.apolloUrl} target="_blank" rel="noreferrer" title={active.apolloUrl} className="hidden max-w-[280px] items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 sm:inline-flex">
            <ExternalLink className="size-3 shrink-0" /> <span className="truncate">{active.apolloUrl.replace(/^https?:\/\//i, "")}</span>
          </a>
        )}
        {/* Desktop inline actions */}
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          {active && (
            <Button size="sm" variant="outline" onClick={() => verify.mutate(active.id)} disabled={verifying || active.summary.people === 0} title="Find & verify emails that have not been checked yet. Results (including Not found) are saved so the same person is not searched twice.">
              {verifying ? <Loader2 className="size-4 animate-spin" /> : <MailCheck className="size-4" />}
              {verifying ? "Finding…" : "Find & verify"}
            </Button>
          )}
          {active && notFound > 0 && (
            <Button size="sm" variant="outline" onClick={() => retryNotFound.mutate(active.id)} disabled={verifying || retryNotFound.isPending} title={`Re-run Find & verify over the ${formatNumber(notFound)} “Not found” ${notFound === 1 ? "person" : "people"} (looked up before, came back empty), searching each one afresh. People who already have an email are left untouched.`}>
              {retryNotFound.isPending ? <Loader2 className="size-4 animate-spin" /> : <MailX className="size-4" />}
              Retry notfound ({formatNumber(notFound)})
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
          {active && <button onClick={async () => { if (await confirm({ title: "Delete people search?", description: `“${active.name}” and its ${formatNumber(active.summary.people)} people will be permanently removed. This can’t be undone.` })) remove.mutate(active.id); }} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-[hsl(var(--invalid))]" aria-label="Delete people search">{remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}</button>}
        </div>
      </div>

      {/* Stats */}
      {s && (
        <StatsBar live={!!live} summary={`${formatNumber(s.people)} people · ${formatNumber(s.withEmail)} emails · ${formatNumber(s.withLinkedin)} LinkedIn`}>
          <Stat icon={Users} label="People" value={formatNumber(s.people)} />
          <Stat icon={Star} label="Founders" value={formatNumber(s.founders)} />
          <Stat icon={Crown} label="C-Level" value={formatNumber(s.cLevel)} />
          <Stat icon={Users} label="VP / Pres" value={formatNumber(s.vps)} />
          <Stat icon={Building2} label={seedLabel} value={active.mode === "enrich" ? `${formatNumber(s.rowsWithPeople ?? s.people)}/${formatNumber(s.companies)}` : `${formatNumber(s.companiesWithPeople)}/${formatNumber(s.companies)}`} />
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
          jobName={active?.name}
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

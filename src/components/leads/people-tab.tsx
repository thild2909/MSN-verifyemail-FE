"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Trash2, Loader2, Crown, Building2, Mail, Linkedin, MailCheck, UserSearch, Star, Upload, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatNumber, formatDate, cn } from "@/lib/utils";
import { getPeopleJobs, getPeopleJob, deletePeopleJob, verifyPeopleEmails, llmVerifyPeople, ApiError } from "@/lib/api/client";
import { CollectedPeopleTable } from "./collected-people-table";
import { PersonDetailDrawer } from "./people-detail-drawer";
import { PeopleImportFlow } from "./people-import-flow";
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
    mutationFn: (id: string) => verifyPeopleEmails(id, false),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["people-job", activeId] });
      qc.invalidateQueries({ queryKey: ["collect-people", activeId] });
      toast(r.verified === 0
        ? { variant: "info", title: "Nothing to verify", description: "No new emails to check." }
        : { variant: "success", title: "Emails verified", description: `${r.valid}/${r.verified} deliverable · via ${r.provider}` });
    },
    onError: () => toast({ variant: "error", title: "Verification failed" }),
  });

  // LLM (DeepSeek) founder↔company cross-check — opt-in, batched.
  const llmVerify = useMutation({
    mutationFn: (id: string) => llmVerifyPeople(id, false),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["collect-people", activeId] });
      toast(
        r.checked === 0
          ? { variant: "info", title: "Nothing to review", description: "All people already AI-checked." }
          : { variant: r.mismatch > 0 ? "error" : "success", title: `AI reviewed ${r.checked} people`, description: `${r.verified} match · ${r.mismatch} mismatch · ${r.uncertain} uncertain · ${formatNumber(r.tokens)} tokens` },
      );
    },
    onError: (e) => toast({ variant: "error", title: "AI verify failed", description: e instanceof ApiError && e.code === "LLM_NOT_CONFIGURED" ? "Set DEEPSEEK_API_KEY in the app env." : "Try again." }),
  });

  const verifying = active?.verifyStatus === "verifying" || verify.isPending;
  const live = active?.status === "collecting" || verifying;
  const s = active?.summary;
  const seedLabel = active?.mode === "enrich" ? "Rows" : "Companies";

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
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <Select value={activeId ?? ""} onChange={(e) => setActiveId(e.target.value)} className="h-9 w-64">
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.name} · {formatDate(j.createdAt)}</option>)}
        </Select>
        {active && <span className="text-xs text-muted-foreground">{formatNumber(active.summary.people)} people · {formatNumber(active.totalCompanies)} {active.mode === "enrich" ? "rows" : "companies"}</span>}
        <div className="ml-auto flex items-center gap-2">
          {active && (
            <Button size="sm" variant="outline" onClick={() => verify.mutate(active.id)} disabled={verifying || active.summary.withEmail === 0}>
              {verifying ? <Loader2 className="size-4 animate-spin" /> : <MailCheck className="size-4" />}
              {verifying ? "Verifying…" : "Verify emails"}
            </Button>
          )}
          {active && active.summary.people > 0 && (
            <Button size="sm" variant="outline" onClick={() => llmVerify.mutate(active.id)} disabled={llmVerify.isPending}>
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
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-2.5 text-sm">
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
        </div>
      )}

      {/* Per-company coverage (discover mode): shows which companies yielded
          people and which returned none — so a 0-yield company is explicit. */}
      {active?.mode === "discover" && (active.coverage?.length ?? 0) > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/10 px-4 py-2 text-xs">
          <span className="mr-1 font-medium text-muted-foreground">Coverage:</span>
          {active.coverage!.map((c, i) => {
            const none = c.status === "done" && c.peopleFound === 0;
            const pending = c.status === "pending" || c.status === "collecting";
            return (
              <span key={i} title={none ? "No public LinkedIn profiles are indexed for this company yet." : undefined}
                className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
                  pending ? "bg-muted text-muted-foreground" : none ? "bg-amber-500/12 text-amber-600 dark:text-amber-400" : "bg-[hsl(var(--valid))]/12 text-[hsl(var(--valid))]")}>
                {pending && <Loader2 className="size-3 animate-spin" />}
                {c.company.length > 26 ? c.company.slice(0, 26) + "…" : c.company} · {pending ? "…" : none ? "0 found" : c.peopleFound}
              </span>
            );
          })}
        </div>
      )}

      {/* Table */}
      {activeId && <CollectedPeopleTable jobId={activeId} live={!!live} onOpenPerson={setDrawer} />}

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

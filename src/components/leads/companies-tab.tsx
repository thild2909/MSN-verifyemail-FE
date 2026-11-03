"use client";
import { JobPicker } from "./job-picker";
import { Building2 as PickerCompanyIcon, Upload as UploadGlyph } from "lucide-react";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload, Building2, Trash2, Loader2, Globe, Mail, Phone, Linkedin, RotateCw, AlertTriangle, Search, Landmark, Database, MailCheck, Sparkles, MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatNumber, formatDate, cn } from "@/lib/utils";
import { getCollectJobs, getCollectJob, deleteCollectJob, retryFailedCollect, verifyCollectedEmails, createPeopleJob, llmVerifyCompanies, ApiError } from "@/lib/api/client";
import { CompanyImportFlow } from "./company-import-flow";
import { CollectedCompaniesTable, type FindPeoplePayload } from "./collected-companies-table";
import { StatsBar } from "./stats-bar";
import { CompanyCollectDrawer } from "./company-collect-drawer";
import type { CollectedCompany, CompanyCollectJob } from "@/lib/leads/collect-types";

export function CompaniesTab({ onNavigatePeople }: { onNavigatePeople?: (jobId: string) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [importOpen, setImportOpen] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [drawer, setDrawer] = React.useState<CollectedCompany | null>(null);

  const { data: jobs } = useQuery({
    queryKey: ["collect-jobs"],
    queryFn: getCollectJobs,
    refetchInterval: (q) => (q.state.data as CompanyCollectJob[] | undefined)?.some((j) => j.status === "collecting" || j.verifyStatus === "verifying") ? 2000 : false,
  });

  // Default to the newest job.
  React.useEffect(() => {
    if (!activeId && jobs && jobs.length) setActiveId(jobs[0].id);
  }, [jobs, activeId]);

  const { data: active } = useQuery({
    queryKey: ["collect-job", activeId],
    queryFn: () => getCollectJob(activeId!),
    enabled: !!activeId,
    refetchInterval: (q) => { const j = q.state.data as CompanyCollectJob | undefined; return j?.status === "collecting" || j?.verifyStatus === "verifying" ? 1500 : false; },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCollectJob(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["collect-jobs"] }); setActiveId(null); toast({ variant: "success", title: "Collection deleted" }); },
    onError: () => toast({ variant: "error", title: "Could not delete" }),
  });

  const retryFailed = useMutation({
    mutationFn: (id: string) => retryFailedCollect(id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["collect-jobs"] });
      qc.invalidateQueries({ queryKey: ["collect-job", activeId] });
      qc.invalidateQueries({ queryKey: ["collect-companies", activeId] });
      toast(
        r.reset
          ? { variant: "success", title: "Retrying failed rows", description: `${r.reset} companies re-queued for a fresh crawl.` }
          : { variant: "info", title: "Nothing to retry", description: "No failed companies in this collection." },
      );
    },
    onError: () => toast({ variant: "error", title: "Retry failed" }),
  });

  // Verify only emails not yet checked (resource-saving); this is user-triggered,
  // never automatic. `all` param stays false so re-clicking is cheap.
  const verify = useMutation({
    mutationFn: (id: string) => verifyCollectedEmails(id, false),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["collect-job", activeId] });
      qc.invalidateQueries({ queryKey: ["collect-companies", activeId] });
      toast(
        r.verified === 0
          ? { variant: "info", title: "Nothing to verify", description: "No new contact emails to check." }
          : { variant: "success", title: "Emails verified", description: `${r.valid}/${r.verified} deliverable · via ${r.provider}` },
      );
    },
    onError: () => toast({ variant: "error", title: "Verification failed" }),
  });

  // "Find people" — create a real people-collect job seeded from the selected
  // companies (server builds seeds from resolved companies), then jump to People.
  const findPeople = useMutation({
    mutationFn: (payload: FindPeoplePayload) =>
      createPeopleJob({
        name: `People from ${active?.name ?? "Companies"}`,
        fromCompanyJob: activeId!,
        ...(payload.allMatching
          ? { allMatching: true, search: payload.search, ...payload.filters }
          : { companyIds: payload.companyIds }),
      }),
    onSuccess: ({ job }, payload) => {
      qc.invalidateQueries({ queryKey: ["people-jobs"] });
      toast({ variant: "success", title: "Finding people…", description: `Crawling founders & C-level for ${formatNumber(payload.count)} ${payload.count === 1 ? "company" : "companies"}.` });
      onNavigatePeople?.(job.id);
    },
    onError: (e) => toast({ variant: "error", title: "Couldn't start", description: e instanceof Error ? e.message : "Try again." }),
  });

  // "AI verify" (DeepSeek) — one click: audit enriched rows + knowledge-fill
  // the failed / not-found rows. Opt-in, batched (merged prompts, tokens saved).
  const llmVerify = useMutation({
    mutationFn: (id: string) => llmVerifyCompanies(id, false),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["collect-job", activeId] });
      qc.invalidateQueries({ queryKey: ["collect-companies", activeId] });
      if (r.checked === 0 && r.targeted === 0) {
        toast({ variant: "info", title: "Nothing to do", description: r.skipped > 0 ? `Skipped ${r.skipped} high-confidence companies (no LLM needed).` : "All rows already AI-processed." });
        return;
      }
      const parts: string[] = [];
      if (r.targeted > 0) parts.push(`filled ${r.filled}/${r.targeted} unresolved`);
      if (r.checked > 0) parts.push(`${r.verified} consistent · ${r.mismatch} mismatch · ${r.uncertain} uncertain`);
      parts.push(`${formatNumber(r.tokens)} tokens`);
      toast({
        variant: r.mismatch > 0 ? "error" : "success",
        title: r.filled > 0 ? `AI filled ${r.filled} + reviewed ${r.checked}` : `AI reviewed ${r.checked} companies`,
        description: parts.join(" · "),
      });
    },
    onError: (e) => toast({ variant: "error", title: "AI verify failed", description: e instanceof ApiError && e.code === "LLM_NOT_CONFIGURED" ? "Set DEEPSEEK_API_KEY in the app env." : "Try again." }),
  });

  const verifying = active?.verifyStatus === "verifying" || verify.isPending;
  const live = active?.status === "collecting" || verifying;

  const modals = (
    <>
      <CompanyImportFlow open={importOpen} onOpenChange={setImportOpen} onCreated={(id) => { qc.invalidateQueries({ queryKey: ["collect-jobs"] }); setActiveId(id); }} />
      <CompanyCollectDrawer company={drawer} open={!!drawer} onOpenChange={(o) => !o && setDrawer(null)} />
    </>
  );

  if (!jobs || jobs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <EmptyState
          icon={Building2}
          title="Import companies to enrich"
          description="Upload a CSV with Company Name and Location. We find each company's website, email, phone, LinkedIn, socials and key details."
          action={
            <div className="flex items-center gap-2">
              <Button onClick={() => setImportOpen(true)}><Upload /> Import companies</Button>
            </div>
          }
        />
        {modals}
      </div>
    );
  }

  const s = active?.summary;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Tab toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2.5 sm:px-6">
        <div className="flex w-full items-center gap-2 sm:contents">
          <JobPicker
            jobs={jobs.map((j) => ({ id: j.id, name: j.name, createdAt: j.createdAt, status: j.status, progress: j.progress, count: { n: j.total, unit: "companies" } }))}
            value={activeId}
            onChange={setActiveId}
            icon={PickerCompanyIcon}
            label="Company imports"
            className="min-w-0 flex-1 sm:w-72 sm:flex-none"
            footer={(close) => (
              <button type="button" onClick={() => { close(); setImportOpen(true); }} className="flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium text-brand transition-colors hover:bg-brand/10">
                <UploadGlyph className="size-4" /> Import companies
              </button>
            )}
          />
          {/* Mobile-only compact actions */}
          <div className="flex items-center gap-1.5 sm:hidden">
            <Button size="icon" className="shrink-0" onClick={() => setImportOpen(true)} aria-label="Import companies"><Upload /></Button>
            <DropdownMenu align="end" trigger={<Button size="icon" variant="outline" className="shrink-0" aria-label="Actions"><MoreHorizontal /></Button>}>
              {active && <DropdownItem disabled={verifying} onClick={() => verify.mutate(active.id)}><MailCheck /> Verify emails</DropdownItem>}
              {active && <DropdownItem disabled={llmVerify.isPending} onClick={() => llmVerify.mutate(active.id)}><Sparkles /> AI verify</DropdownItem>}
              {active && <DropdownItem disabled={retryFailed.isPending || active.status === "collecting"} onClick={() => retryFailed.mutate(active.id)}><RotateCw /> Retry failed</DropdownItem>}
              {active && (
                <>
                  <DropdownSeparator />
                  <DropdownItem destructive onClick={async () => { if (await confirm({ title: "Delete collection?", description: `“${active.name}” and its ${formatNumber(active.total)} companies will be permanently removed. This can’t be undone.` })) remove.mutate(active.id); }}><Trash2 /> Delete collection</DropdownItem>
                </>
              )}
            </DropdownMenu>
          </div>
        </div>
        {active && (
          <span className="hidden items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-xs text-muted-foreground sm:inline-flex">
            {live && <span className="inline-flex items-center gap-1 rounded bg-brand/10 px-1 text-[10px] font-semibold text-brand"><span className="size-1.5 animate-pulse rounded-full bg-brand" /> Live</span>}
            <span className="font-semibold tabular-nums text-foreground">{formatNumber(active.total)}</span> companies
          </span>
        )}
        {/* Desktop inline actions */}
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          {active && (
            <>
              <Button size="sm" variant="brand" onClick={() => verify.mutate(active.id)} disabled={verifying} title="Find and verify contact emails for the companies in this collection.">
                {verifying ? <Loader2 className="animate-spin" /> : <MailCheck />}
                {verifying ? "Verifying…" : "Verify emails"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => retryFailed.mutate(active.id)} disabled={retryFailed.isPending || active.status === "collecting"} title="Re-run the companies that failed to resolve.">
                {retryFailed.isPending ? <Loader2 className="animate-spin" /> : <RotateCw className="text-[hsl(var(--risky))]" />}
                Retry failed
              </Button>
              <Button size="sm" variant="outline" onClick={() => llmVerify.mutate(active.id)} disabled={llmVerify.isPending} title="AI cross-check the collected company data.">
                {llmVerify.isPending ? <Loader2 className="animate-spin" /> : <Sparkles className="text-[hsl(280_62%_55%)] dark:text-[hsl(280_80%_76%)]" />}
                {llmVerify.isPending ? "Reviewing…" : "AI verify"}
              </Button>
              <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
            </>
          )}
          <Button size="sm" onClick={() => setImportOpen(true)}><Upload /> Import companies</Button>
          {active && (
            <Button
              size="icon"
              variant="ghost"
              className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={async () => { if (await confirm({ title: "Delete collection?", description: `“${active.name}” and its ${formatNumber(active.total)} companies will be permanently removed. This can’t be undone.` })) remove.mutate(active.id); }}
              aria-label="Delete collection"
              title="Delete collection"
            >
              {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      {s && (
        <StatsBar live={!!live} summary={`${formatNumber(s.enriched)}/${formatNumber(s.total)} enriched · ${formatNumber(s.withEmail)} emails`}>
          <Stat icon={Building2} label="Enriched" value={`${formatNumber(s.enriched)}/${formatNumber(s.total)}`} tone="valid" />
          <Stat icon={Search} label="Resolved" value={formatNumber(s.resolved)} tone="brand" />
          <Stat icon={Globe} label="Website" value={formatNumber(s.withWebsite)} />
          <Stat icon={Mail} label="Email" value={formatNumber(s.withEmail)} />
          <Stat icon={Phone} label="Phone" value={formatNumber(s.withPhone)} />
          <Stat icon={Linkedin} label="LinkedIn" value={formatNumber(s.withLinkedin)} />
          <Stat icon={Landmark} label="Legal entity" value={formatNumber(s.withLegalEntity)} />
          <Stat icon={MailCheck} label="Valid emails" value={`${formatNumber(s.emailsValid)}/${formatNumber(s.emailsVerified)}`} tone="valid" />
          <Stat icon={Database} label="Cache hits" value={formatNumber(s.cacheHits)} />
          <Stat icon={AlertTriangle} label="Rate-limited" value={formatNumber(s.rateLimited)} tone="risky" />
          {live && (
            <div className="flex min-w-[160px] flex-1 items-center gap-2">
              {active.verifyStatus === "verifying"
                ? <span className="inline-flex items-center gap-1.5 rounded-md bg-brand/10 px-2 py-1 text-xs font-medium text-brand"><span className="size-1.5 rounded-full bg-brand animate-pulse" /> Verifying emails…</span>
                : <>
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand"><span className="size-1.5 rounded-full bg-brand animate-pulse" /> Collecting</span>
                    <Progress value={active.progress} className="flex-1" />
                    <span className="text-xs font-semibold tabular-nums text-foreground">{active.progress}%</span>
                  </>}
            </div>
          )}
        </StatsBar>
      )}

      {/* Table */}
      {activeId && (
        <CollectedCompaniesTable
          jobId={activeId}
          jobName={active?.name}
          live={!!live}
          onOpenCompany={setDrawer}
          onFindPeople={(payload) => findPeople.mutate(payload)}
          findingPeople={findPeople.isPending}
        />
      )}

      {modals}
    </div>
  );
}

const STAT_TONE = {
  muted: "bg-surface text-muted-foreground",
  brand: "bg-brand/10 text-brand",
  valid: "bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]",
  risky: "bg-[hsl(var(--risky)/0.14)] text-[hsl(var(--risky))]",
} as const;

function Stat({ icon: Icon, label, value, tone = "muted" }: { icon: React.ElementType; label: string; value: string; tone?: keyof typeof STAT_TONE }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card py-1 pl-1 pr-2.5 shadow-xs">
      <span className={cn("flex size-6 items-center justify-center rounded-md", STAT_TONE[tone])}>
        <Icon className="size-3.5" strokeWidth={1.75} />
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", tone === "risky" && "text-[hsl(var(--risky))]")}>{value}</span>
    </div>
  );
}

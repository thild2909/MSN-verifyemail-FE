"use client";
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
              <Button onClick={() => setImportOpen(true)}><Upload className="size-4" /> Import companies</Button>
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
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 md:py-2.5">
        <div className="flex w-full items-center gap-2 sm:contents">
          <Select value={activeId ?? ""} onChange={(e) => setActiveId(e.target.value)} className="h-9 min-w-0 flex-1 sm:w-56 sm:flex-none">
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.name} · {formatDate(j.createdAt)}</option>)}
          </Select>
          {/* Mobile-only compact actions */}
          <div className="flex items-center gap-1.5 sm:hidden">
            <Button size="icon" className="size-9 shrink-0" onClick={() => setImportOpen(true)} aria-label="Import companies"><Upload className="size-4" /></Button>
            <DropdownMenu align="end" trigger={<Button size="icon" variant="outline" className="size-9 shrink-0" aria-label="Actions"><MoreHorizontal className="size-4" /></Button>}>
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
        {active && <span className="hidden text-xs text-muted-foreground sm:inline">{formatNumber(active.total)} companies</span>}
        {/* Desktop inline actions */}
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          {active && (
            <Button size="sm" variant="outline" onClick={() => verify.mutate(active.id)} disabled={verifying}>
              {verifying ? <Loader2 className="size-4 animate-spin" /> : <MailCheck className="size-4" />}
              {verifying ? "Verifying…" : "Verify emails"}
            </Button>
          )}
          {active && (
            <Button size="sm" variant="outline" onClick={() => llmVerify.mutate(active.id)} disabled={llmVerify.isPending}>
              {llmVerify.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {llmVerify.isPending ? "Reviewing…" : "AI verify"}
            </Button>
          )}
          <Button size="sm" onClick={() => setImportOpen(true)}><Upload className="size-4" /> Import</Button>
          {active && (
            <Button size="sm" variant="outline" onClick={() => retryFailed.mutate(active.id)} disabled={retryFailed.isPending || active.status === "collecting"}>
              {retryFailed.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
              Retry failed
            </Button>
          )}
          {active && <button onClick={async () => { if (await confirm({ title: "Delete collection?", description: `“${active.name}” and its ${formatNumber(active.total)} companies will be permanently removed. This can’t be undone.` })) remove.mutate(active.id); }} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-[hsl(var(--invalid))]" aria-label="Delete collection">{remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}</button>}
        </div>
      </div>

      {/* Stats */}
      {s && (
        <StatsBar live={!!live} summary={`${formatNumber(s.enriched)}/${formatNumber(s.total)} enriched · ${formatNumber(s.withEmail)} emails`}>
          <Stat icon={Building2} label="Enriched" value={`${formatNumber(s.enriched)}/${formatNumber(s.total)}`} />
          <Stat icon={Search} label="Resolved" value={formatNumber(s.resolved)} />
          <Stat icon={Globe} label="Website" value={formatNumber(s.withWebsite)} />
          <Stat icon={Mail} label="Email" value={formatNumber(s.withEmail)} />
          <Stat icon={Phone} label="Phone" value={formatNumber(s.withPhone)} />
          <Stat icon={Linkedin} label="LinkedIn" value={formatNumber(s.withLinkedin)} />
          <Stat icon={Landmark} label="Legal entity" value={formatNumber(s.withLegalEntity)} />
          <Stat icon={MailCheck} label="Valid emails" value={`${formatNumber(s.emailsValid)}/${formatNumber(s.emailsVerified)}`} />
          <Stat icon={Database} label="Cache hits" value={formatNumber(s.cacheHits)} />
          <Stat icon={AlertTriangle} label="Rate-limited" value={formatNumber(s.rateLimited)} tone="risky" />
          {live && (
            <div className="flex min-w-[160px] flex-1 items-center gap-2">
              {active.verifyStatus === "verifying"
                ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--risky))]"><Loader2 className="size-3.5 animate-spin" /> Verifying emails…</span>
                : <><Progress value={active.progress} className="flex-1" /><span className="tabular-nums text-muted-foreground">{active.progress}%</span></>}
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

function Stat({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: string; tone?: "risky" }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={cn("size-3.5", tone === "risky" ? "text-[hsl(var(--risky))]" : "text-muted-foreground")} />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", tone === "risky" && "text-[hsl(var(--risky))]")}>{value}</span>
    </div>
  );
}

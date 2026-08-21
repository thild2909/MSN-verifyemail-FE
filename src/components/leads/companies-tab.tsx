"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload, Server, Building2, Trash2, Loader2, ShieldCheck, ShieldOff, Globe, Mail, Phone, Linkedin, RotateCw, AlertTriangle, Search, Landmark, Database, MailCheck, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatNumber, formatDate, cn } from "@/lib/utils";
import { getCollectJobs, getCollectJob, deleteCollectJob, getProxyConfig, verifyCollectedEmails, createPeopleJob, llmVerifyCompanies, ApiError } from "@/lib/api/client";
import { CompanyImportFlow } from "./company-import-flow";
import { ProxySettings } from "./proxy-settings";
import { CollectedCompaniesTable, type FindPeoplePayload } from "./collected-companies-table";
import { CompanyCollectDrawer } from "./company-collect-drawer";
import type { CollectedCompany, CompanyCollectJob } from "@/lib/leads/collect-types";

export function CompaniesTab({ onNavigatePeople }: { onNavigatePeople?: (jobId: string) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [importOpen, setImportOpen] = React.useState(false);
  const [proxyOpen, setProxyOpen] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [drawer, setDrawer] = React.useState<CollectedCompany | null>(null);

  const { data: jobs } = useQuery({
    queryKey: ["collect-jobs"],
    queryFn: getCollectJobs,
    refetchInterval: (q) => (q.state.data as CompanyCollectJob[] | undefined)?.some((j) => j.status === "collecting" || j.verifyStatus === "verifying") ? 2000 : false,
  });
  const { data: proxy } = useQuery({ queryKey: ["proxy-config"], queryFn: getProxyConfig });

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
        name: `${active?.name ?? "Companies"} — people`,
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

  // LLM (DeepSeek) cross-check of the collected companies — opt-in, batched.
  const llmVerify = useMutation({
    mutationFn: (id: string) => llmVerifyCompanies(id, false),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["collect-companies", activeId] });
      toast(
        r.checked === 0
          ? { variant: "info", title: "Nothing to review", description: r.skipped > 0 ? `Skipped ${r.skipped} high-confidence companies (no LLM needed).` : "All rows already AI-checked." }
          : { variant: r.mismatch > 0 ? "error" : "success", title: `AI reviewed ${r.checked} companies`, description: `${r.verified} consistent · ${r.mismatch} mismatch · ${r.uncertain} uncertain · skipped ${r.skipped} high-conf · ${formatNumber(r.tokens)} tokens` },
      );
    },
    onError: (e) => toast({ variant: "error", title: "AI verify failed", description: e instanceof ApiError && e.code === "LLM_NOT_CONFIGURED" ? "Set DEEPSEEK_API_KEY in the app env." : "Try again." }),
  });

  const enabledProxies = proxy?.proxies.filter((p) => p.enabled).length ?? 0;
  const rotatingActive = proxy?.rotating?.active ?? false;
  const proxyLayerOn = rotatingActive || (proxy?.enabled ?? false);
  const verifying = active?.verifyStatus === "verifying" || verify.isPending;
  const live = active?.status === "collecting" || verifying;

  const modals = (
    <>
      <CompanyImportFlow open={importOpen} onOpenChange={setImportOpen} onCreated={(id) => { qc.invalidateQueries({ queryKey: ["collect-jobs"] }); setActiveId(id); }} />
      <ProxySettings open={proxyOpen} onOpenChange={(o) => { setProxyOpen(o); if (!o) qc.invalidateQueries({ queryKey: ["proxy-config"] }); }} />
      <CompanyCollectDrawer company={drawer} open={!!drawer} onOpenChange={(o) => !o && setDrawer(null)} />
    </>
  );

  if (!jobs || jobs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <EmptyState
          icon={Building2}
          title="Import companies to enrich"
          description="Upload a CSV with Company Name + Location. We collect website, email, phone, LinkedIn, socials and firmographics from multiple sources — through your configured proxies."
          action={
            <div className="flex items-center gap-2">
              <Button onClick={() => setImportOpen(true)}><Upload className="size-4" /> Import companies</Button>
              <Button variant="outline" onClick={() => setProxyOpen(true)}><Server className="size-4" /> Proxy settings</Button>
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
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <Select value={activeId ?? ""} onChange={(e) => setActiveId(e.target.value)} className="h-9 w-56">
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.name} · {formatDate(j.createdAt)}</option>)}
        </Select>
        {active && <span className="text-xs text-muted-foreground">{formatNumber(active.total)} companies</span>}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setProxyOpen(true)} className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted", proxyLayerOn ? "border-[hsl(var(--valid))]/40 text-[hsl(var(--valid))]" : "border-input text-muted-foreground")}>
            {rotatingActive ? <Globe className="size-3.5" /> : proxy?.enabled ? <ShieldCheck className="size-3.5" /> : <ShieldOff className="size-3.5" />}
            {rotatingActive ? "Rotating residential" : proxy?.enabled ? `Proxies on · ${enabledProxies}` : "Proxies off"}
          </button>
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
          <Button size="sm" variant="outline" onClick={() => setProxyOpen(true)}><Server className="size-4" /> Proxy settings</Button>
          <Button size="sm" onClick={() => setImportOpen(true)}><Upload className="size-4" /> Import</Button>
          {active && <button onClick={() => remove.mutate(active.id)} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-[hsl(var(--invalid))]" aria-label="Delete collection">{remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}</button>}
        </div>
      </div>

      {/* Stats */}
      {s && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-2.5 text-sm">
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
          <Stat icon={RotateCw} label="Proxy rotations" value={formatNumber(s.proxyRotations)} />
          {live && (
            <div className="flex min-w-[160px] flex-1 items-center gap-2">
              {active.verifyStatus === "verifying"
                ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--risky))]"><Loader2 className="size-3.5 animate-spin" /> Verifying emails…</span>
                : <><Progress value={active.progress} className="flex-1" /><span className="tabular-nums text-muted-foreground">{active.progress}%</span></>}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      {activeId && (
        <CollectedCompaniesTable
          jobId={activeId}
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

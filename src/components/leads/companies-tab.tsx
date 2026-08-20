"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload, Server, Building2, Trash2, Loader2, ShieldCheck, ShieldOff, Globe, Mail, Phone, Linkedin, RotateCw, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/common/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatNumber, formatDate, cn } from "@/lib/utils";
import { getCollectJobs, getCollectJob, deleteCollectJob, getProxyConfig } from "@/lib/api/client";
import { CompanyImportFlow } from "./company-import-flow";
import { ProxySettings } from "./proxy-settings";
import { CollectedCompaniesTable } from "./collected-companies-table";
import { CompanyCollectDrawer } from "./company-collect-drawer";
import type { CollectedCompany, CompanyCollectJob } from "@/lib/leads/collect-types";

export function CompaniesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [importOpen, setImportOpen] = React.useState(false);
  const [proxyOpen, setProxyOpen] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [drawer, setDrawer] = React.useState<CollectedCompany | null>(null);

  const { data: jobs } = useQuery({
    queryKey: ["collect-jobs"],
    queryFn: getCollectJobs,
    refetchInterval: (q) => (q.state.data as CompanyCollectJob[] | undefined)?.some((j) => j.status === "collecting") ? 2000 : false,
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
    refetchInterval: (q) => { const j = q.state.data as CompanyCollectJob | undefined; return j?.status === "collecting" ? 1500 : false; },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCollectJob(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["collect-jobs"] }); setActiveId(null); toast({ variant: "success", title: "Collection deleted" }); },
    onError: () => toast({ variant: "error", title: "Could not delete" }),
  });

  const enabledProxies = proxy?.proxies.filter((p) => p.enabled).length ?? 0;
  const live = active?.status === "collecting";

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
          <button onClick={() => setProxyOpen(true)} className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted", proxy?.enabled ? "border-[hsl(var(--valid))]/40 text-[hsl(var(--valid))]" : "border-input text-muted-foreground")}>
            {proxy?.enabled ? <ShieldCheck className="size-3.5" /> : <ShieldOff className="size-3.5" />}
            {proxy?.enabled ? `Proxies on · ${enabledProxies}` : "Proxies off"}
          </button>
          <Button size="sm" variant="outline" onClick={() => setProxyOpen(true)}><Server className="size-4" /> Proxy settings</Button>
          <Button size="sm" onClick={() => setImportOpen(true)}><Upload className="size-4" /> Import</Button>
          {active && <button onClick={() => remove.mutate(active.id)} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-[hsl(var(--invalid))]" aria-label="Delete collection">{remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}</button>}
        </div>
      </div>

      {/* Stats */}
      {s && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-2.5 text-sm">
          <Stat icon={Building2} label="Enriched" value={`${formatNumber(s.enriched)}/${formatNumber(s.total)}`} />
          <Stat icon={Globe} label="Website" value={formatNumber(s.withWebsite)} />
          <Stat icon={Mail} label="Email" value={formatNumber(s.withEmail)} />
          <Stat icon={Phone} label="Phone" value={formatNumber(s.withPhone)} />
          <Stat icon={Linkedin} label="LinkedIn" value={formatNumber(s.withLinkedin)} />
          <Stat icon={AlertTriangle} label="Rate-limited" value={formatNumber(s.rateLimited)} tone="risky" />
          <Stat icon={RotateCw} label="Proxy rotations" value={formatNumber(s.proxyRotations)} />
          {live && <div className="flex min-w-[140px] flex-1 items-center gap-2"><Progress value={active.progress} className="flex-1" /><span className="tabular-nums text-muted-foreground">{active.progress}%</span></div>}
        </div>
      )}

      {/* Table */}
      {activeId && <CollectedCompaniesTable jobId={activeId} live={!!live} onOpenCompany={setDrawer} />}

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

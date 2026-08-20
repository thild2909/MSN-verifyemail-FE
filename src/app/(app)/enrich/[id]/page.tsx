"use client";
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft, Download, FileDown, RefreshCw, MailCheck, Loader2, ChevronDown, User, Building2,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown-menu";
import { EnrichTable } from "@/components/enrich/enrich-table";
import { getEnrichTable, enrichExportUrl, runEnrichTable, pushEnrichToVerification, ApiError } from "@/lib/api/client";
import { formatNumber, formatDate, cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import type { EnrichmentTable } from "@/lib/types";

function download(url: string) {
  const a = document.createElement("a");
  a.href = url; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}

export default function EnrichDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: table, isLoading } = useQuery({
    queryKey: ["enrich-table", params.id],
    queryFn: () => getEnrichTable(params.id),
    refetchInterval: (q) => { const t = q.state.data as EnrichmentTable | undefined; return t?.status === "enriching" || t?.status === "queued" ? 2000 : false; },
  });

  const push = useMutation({
    mutationFn: () => pushEnrichToVerification(params.id),
    onSuccess: ({ listId, count }) => {
      qc.invalidateQueries({ queryKey: ["lists"] }); qc.invalidateQueries({ queryKey: ["credits"] });
      toast({ variant: "success", title: "Pushed to verification", description: `${formatNumber(count)} emails queued.` });
      router.push(`/verification/lists/${listId}`);
    },
    onError: (err) => {
      const insufficient = err instanceof ApiError && err.code === "INSUFFICIENT_CREDITS";
      const noEmails = err instanceof ApiError && err.code === "NO_EMAILS";
      toast({ variant: "error", title: insufficient ? "Insufficient credits" : noEmails ? "No emails yet" : "Could not push", description: noEmails ? "Add a Work Email column and let it run first." : undefined });
    },
  });
  const rerun = useMutation({
    mutationFn: () => runEnrichTable(params.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["enrich-table", params.id] }); qc.invalidateQueries({ queryKey: ["enrich-rows", params.id] }); qc.invalidateQueries({ queryKey: ["credits"] }); toast({ variant: "info", title: "Re-running enrichment" }); },
    onError: (err) => toast({ variant: "error", title: err instanceof ApiError && err.code === "INSUFFICIENT_CREDITS" ? "Insufficient credits" : "Could not re-run" }),
  });

  if (isLoading) {
    return <div className="space-y-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-10 w-full" /><Skeleton className="h-[60vh] w-full" /></div>;
  }
  if (!table) {
    return <div className="py-20 text-center"><p className="text-lg font-semibold">Enrichment table not found</p><Link href="/enrich" className={cn(buttonVariants({ variant: "outline" }), "mt-4")}>Back to enrichment</Link></div>;
  }

  const live = table.status === "enriching" || table.status === "queued";
  const s = table.summary;
  const TypeIcon = table.recordType === "people" ? User : Building2;

  return (
    <div className="space-y-4">
      {/* Breadcrumb + header */}
      <div>
        <Link href="/enrich" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Enrichment</Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <TypeIcon className="size-5 text-muted-foreground" />
              <h1 className="text-2xl font-bold tracking-tight">{table.name}</h1>
              <Badge variant={table.status === "completed" ? "success" : table.status === "failed" ? "destructive" : "warning"}>
                {table.status === "completed" ? "Completed" : table.status === "failed" ? "Failed" : "Enriching"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{table.fileName} · {formatNumber(s.rows)} {table.recordType} · {table.columns.length} columns · created {formatDate(table.createdAt)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <DropdownMenu trigger={<Button variant="outline"><Download className="size-4" /> Export <ChevronDown className="size-4" /></Button>}>
              <DropdownItem onClick={() => download(enrichExportUrl(table.id, "csv"))}><Download /> CSV</DropdownItem>
              <DropdownItem onClick={() => download(enrichExportUrl(table.id, "xlsx"))}><FileDown /> XLSX</DropdownItem>
            </DropdownMenu>
            <Button variant="outline" disabled={rerun.isPending || live} onClick={() => rerun.mutate()}>{rerun.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Re-run</Button>
            <Button disabled={push.isPending || s.emailsFound === 0} onClick={() => push.mutate()}>{push.isPending ? <Loader2 className="size-4 animate-spin" /> : <MailCheck className="size-4" />} Push to verification</Button>
          </div>
        </div>
      </div>

      {/* Compact stats */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card px-4 py-3 text-sm">
        <Stat label="Rows" value={formatNumber(s.rows)} />
        <Stat label="Cells enriched" value={`${formatNumber(s.cellsFound)} / ${formatNumber(s.rows * table.columns.length)}`} />
        <Stat label="Emails found" value={formatNumber(s.emailsFound)} tone="valid" />
        <Stat label="Credits used" value={formatNumber(s.creditsUsed)} />
        <div className="flex min-w-[160px] flex-1 items-center gap-2">
          <Progress value={table.progress} className="flex-1" />
          <span className="tabular-nums text-muted-foreground">{table.progress}%</span>
        </div>
      </div>

      {/* Clay spreadsheet */}
      <div className="flex h-[calc(100vh-19rem)] min-h-[420px] flex-col overflow-hidden rounded-xl border bg-card">
        <EnrichTable table={table} />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "valid" }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("font-semibold tabular-nums", tone === "valid" && "text-[hsl(var(--valid))]")}>{value}</span>
    </div>
  );
}

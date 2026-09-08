"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ShieldCheck, ShieldAlert, ShieldQuestion, Server } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getReputation, refreshReputation } from "@/lib/api/client";
import type { IpReputation } from "@/lib/types";
import { cn } from "@/lib/utils";

function statusBadge(r: IpReputation) {
  if (r.blocked) return <Badge variant="destructive"><ShieldAlert className="size-3" /> Blocked</Badge>;
  if (r.category === "ok") return <Badge variant="success"><ShieldCheck className="size-3" /> Clean</Badge>;
  return <Badge variant="muted"><ShieldQuestion className="size-3" /> Unreachable</Badge>;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function ReputationMonitor() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["reputation"],
    queryFn: getReputation,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
    retry: false,
  });

  const refresh = useMutation({
    mutationFn: refreshReputation,
    onSuccess: (fresh) => {
      if (fresh) qc.setQueryData(["reputation"], fresh);
      else qc.invalidateQueries({ queryKey: ["reputation"] });
    },
  });

  const s = data;
  const summary = s?.summary;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Blacklist Monitor"
        subtitle="Live reputation of your sending IPs, tested the way a real mailbox provider tests them — an SMTP probe against a reference Microsoft MX (catches the commercial Spamhaus feed that free DNSBLs miss)."
        actions={
          <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            <RefreshCw className={cn("size-4", refresh.isPending && "animate-spin")} />
            {refresh.isPending ? "Checking…" : "Re-check now"}
          </Button>
        }
      />

      {/* Summary tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label="Sending IPs" value={summary?.total ?? "—"} icon={<Server className="size-5 text-muted-foreground" />} />
        <SummaryTile label="Clean" value={summary?.clean ?? "—"} icon={<ShieldCheck className="size-5 text-[hsl(var(--valid))]" />} accent="valid" />
        <SummaryTile label="Blocked" value={summary?.blocked ?? "—"} icon={<ShieldAlert className="size-5 text-[hsl(var(--invalid))]" />} accent={summary?.blocked ? "invalid" : undefined} />
        <SummaryTile label="Unreachable" value={summary?.unknownIps.length ?? "—"} icon={<ShieldQuestion className="size-5 text-muted-foreground" />} />
      </div>

      {/* Overall banner */}
      {summary?.allBlocked && (
        <div className="flex items-start gap-2 rounded-lg border border-[hsl(var(--invalid))]/30 bg-invalid/10 px-4 py-3 text-sm text-[hsl(var(--invalid))]">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p><span className="font-semibold">All sending IPs are blocked.</span> SMTP verifications to strict providers (Microsoft, Proofpoint, Mimecast) will return “unknown”. Microsoft verification still works via the HTTPS API path. Consider adding a clean egress IP or requesting delisting.</p>
        </div>
      )}
      {summary?.anyBlocked && !summary.allBlocked && (
        <div className="flex items-start gap-2 rounded-lg border border-[hsl(var(--risky))]/30 bg-risky/10 px-4 py-3 text-sm text-[hsl(var(--risky))]">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p><span className="font-semibold">{summary.blocked} of {summary.total} IPs are blocked.</span> Clean IPs remain, so verification is unaffected for now. Blocked: {summary.blockedIps.join(", ")}.</p>
        </div>
      )}

      {/* Per-IP table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Sending IP</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Code</th>
                <th className="px-4 py-2.5 font-medium">Response</th>
                <th className="px-4 py-2.5 font-medium">Last checked</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Testing sending IPs…</td></tr>
              )}
              {isError && !isLoading && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-[hsl(var(--invalid))]">Could not load reputation status.</td></tr>
              )}
              {!isLoading && s?.ips.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No public sending IPs detected on this host.</td></tr>
              )}
              {s?.ips.map((r) => (
                <tr key={r.ip} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{r.ip}</td>
                  <td className="px-4 py-3">{statusBadge(r)}</td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{r.code ?? "—"}</td>
                  <td className="max-w-[26rem] px-4 py-3 text-xs text-muted-foreground"><span className="line-clamp-2" title={r.message}>{r.message || "—"}</span></td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{fmtTime(r.checkedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Context */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Reference MX: <span className="font-mono">{s?.refMx ?? s?.refDomain ?? "—"}</span>. A “Blocked” result means that MX
        refused a connection from that source IP on reputation grounds (e.g. Spamhaus). This is checked with a benign SMTP
        handshake (no message is ever sent) and re-run automatically every {Math.round((s?.ttlMs ?? 600000) / 60000)} minutes.
        Verification for Microsoft 365 is unaffected regardless — it runs over the HTTPS GetCredentialType API, not SMTP.
      </p>
    </div>
  );
}

function SummaryTile({ label, value, icon, accent }: { label: string; value: React.ReactNode; icon: React.ReactNode; accent?: "valid" | "invalid" }) {
  return (
    <Card className="flex items-center justify-between p-4">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("mt-1 text-2xl font-semibold tabular-nums", accent === "valid" && "text-[hsl(var(--valid))]", accent === "invalid" && "text-[hsl(var(--invalid))]")}>{value}</p>
      </div>
      {icon}
    </Card>
  );
}

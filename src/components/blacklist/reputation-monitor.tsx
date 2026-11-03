"use client";
import { ColHead } from "@/components/common/col-head";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ShieldCheck, ShieldAlert, ShieldQuestion, Server, Info, Network, Clock } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconTile, Pill, SectionCard, type Tone } from "@/components/common/kit";
import { getReputation, refreshReputation } from "@/lib/api/client";
import type { IpReputation } from "@/lib/types";
import { cn } from "@/lib/utils";

function ipStatus(r: IpReputation): { label: string; tone: Tone; icon: React.ElementType } {
  if (r.blocked) return { label: "Blocked", tone: "invalid", icon: ShieldAlert };
  if (r.category === "ok") return { label: "Clean", tone: "valid", icon: ShieldCheck };
  return { label: "Unreachable", tone: "muted", icon: ShieldQuestion };
}

function StatusPill({ r }: { r: IpReputation }) {
  const s = ipStatus(r);
  return (
    <Pill tone={s.tone}>
      <s.icon className="size-3" /> {s.label}
    </Pill>
  );
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
  const ips = s?.ips ?? [];
  const minutes = Math.round((s?.ttlMs ?? 600000) / 60000);

  const tiles: { label: string; value: React.ReactNode; icon: React.ElementType; tone: Tone; valueClass?: string }[] = [
    { label: "Sending IPs", value: summary?.total ?? "—", icon: Server, tone: "brand" },
    { label: "Clean", value: summary?.clean ?? "—", icon: ShieldCheck, tone: "valid", valueClass: "text-[hsl(var(--valid))]" },
    { label: "Blocked", value: summary?.blocked ?? "—", icon: ShieldAlert, tone: "invalid", valueClass: summary?.blocked ? "text-[hsl(var(--invalid))]" : undefined },
    { label: "Unreachable", value: summary?.unknownIps.length ?? "—", icon: ShieldQuestion, tone: "muted" },
  ];

  // Overall health banner.
  const banner = !summary
    ? null
    : summary.allBlocked
      ? {
          tone: "invalid" as Tone,
          icon: ShieldAlert,
          title: "All sending IPs are blocked",
          body: "SMTP verifications to strict providers (Microsoft, Proofpoint, Mimecast) will return “unknown”. Microsoft verification still works via the HTTPS API path. Consider adding a clean egress IP or requesting delisting.",
        }
      : summary.anyBlocked
        ? {
            tone: "risky" as Tone,
            icon: ShieldAlert,
            title: `${summary.blocked} of ${summary.total} IPs are blocked`,
            body: `Clean IPs remain, so verification is unaffected for now. Blocked: ${summary.blockedIps.join(", ")}.`,
          }
        : summary.total > 0
          ? {
              tone: "valid" as Tone,
              icon: ShieldCheck,
              title: "All sending IPs are clean",
              body: `${summary.clean} of ${summary.total} IPs passed the reputation probe on the last check.`,
            }
          : null;

  const BANNER_BORDER: Record<string, string> = {
    invalid: "border-[hsl(var(--invalid)/0.3)] bg-[hsl(var(--invalid)/0.06)]",
    risky: "border-[hsl(var(--risky)/0.3)] bg-[hsl(var(--risky)/0.06)]",
    valid: "border-[hsl(var(--valid)/0.25)] bg-[hsl(var(--valid)/0.05)]",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Blacklist monitor"
        subtitle="Live reputation of your sending IPs, tested the way a real mailbox provider tests them."
        actions={
          <Button variant="brand" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            <RefreshCw className={cn(refresh.isPending && "animate-spin")} />
            {refresh.isPending ? "Checking…" : "Re-check now"}
          </Button>
        }
      />

      {/* Summary strip */}
      <Card className="grid grid-cols-2 divide-border lg:grid-cols-4 lg:divide-x">
        {tiles.map((t) => (
          <div key={t.label} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
            <IconTile icon={t.icon} tone={t.tone} className="rounded-full" />
            <div>
              <p className="text-[13px] text-muted-foreground">{t.label}</p>
              <p className={cn("text-xl font-semibold tabular-nums", t.valueClass)}>{t.value}</p>
            </div>
          </div>
        ))}
      </Card>

      {banner && (
        <div className={cn("flex items-start gap-3 rounded-xl border p-4", BANNER_BORDER[banner.tone])}>
          <IconTile icon={banner.icon} tone={banner.tone} />
          <div className="min-w-0 text-sm">
            <p className="font-semibold">{banner.title}</p>
            <p className="mt-0.5 text-muted-foreground">{banner.body}</p>
          </div>
        </div>
      )}

      <SectionCard
        icon={Network}
        tone="sky"
        title="Sending IPs"
        description="SMTP probe result per egress IP."
        aside={
          s?.checkedAt ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" /> {fmtTime(s.checkedAt)}
            </span>
          ) : undefined
        }
        bodyClassName="p-0"
      >
        {isLoading ? (
          <p className="px-5 py-12 text-center text-sm text-muted-foreground">Testing sending IPs…</p>
        ) : isError ? (
          <p className="px-5 py-12 text-center text-sm text-[hsl(var(--invalid))]">Could not load reputation status.</p>
        ) : ips.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-muted-foreground">No public sending IPs detected on this host.</p>
        ) : (
          <>
            {/* Mobile */}
            <ul className="divide-y divide-border md:hidden">
              {ips.map((r) => (
                <li key={r.ip} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[13px] font-medium">{r.ip}</span>
                    <StatusPill r={r} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>Code <span className="tabular-nums text-foreground">{r.code ?? "—"}</span></span>
                    <span>{fmtTime(r.checkedAt)}</span>
                  </div>
                  {r.message && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={r.message}>{r.message}</p>}
                </li>
              ))}
            </ul>

            {/* Desktop */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface/60 text-left text-[13px] font-normal text-muted-foreground">
                    <th className="px-5 py-3"><ColHead label="Sending IP" /></th>
                    <th className="px-4 py-3"><ColHead label="Status" /></th>
                    <th className="px-4 py-3"><ColHead label="Code" /></th>
                    <th className="px-4 py-3"><ColHead label="Response" /></th>
                    <th className="px-5 py-3"><ColHead label="Last checked" /></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ips.map((r) => {
                    const st = ipStatus(r);
                    return (
                      <tr key={r.ip} className="transition-colors hover:bg-surface/60">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className={cn("size-2 rounded-full", st.tone === "valid" ? "bg-[hsl(var(--valid))]" : st.tone === "invalid" ? "bg-[hsl(var(--invalid))]" : "bg-muted-foreground/50")} />
                            <span className="font-mono text-[13px] font-medium">{r.ip}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3"><StatusPill r={r} /></td>
                        <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">{r.code ?? "—"}</td>
                        <td className="max-w-[26rem] px-4 py-3 text-xs text-muted-foreground"><span className="line-clamp-2" title={r.message}>{r.message || "—"}</span></td>
                        <td className="whitespace-nowrap px-5 py-3 text-xs text-muted-foreground">{fmtTime(r.checkedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>

      {/* How it works */}
      <SectionCard icon={Info} tone="muted" title="How this check works">
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          {[
            { k: "Reference MX", v: <span className="font-mono text-xs">{s?.refMx ?? s?.refDomain ?? "—"}</span> },
            { k: "Method", v: "Benign SMTP handshake — no message is ever sent" },
            { k: "Re-check", v: `Automatically every ${minutes} minutes` },
          ].map((x) => (
            <div key={x.k} className="rounded-lg border border-border bg-surface/50 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{x.k}</p>
              <p className="mt-1 text-[13px]">{x.v}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          A “Blocked” result means that MX refused a connection from that source IP on reputation grounds (e.g. Spamhaus) — the
          commercial feed that free DNSBLs miss. Verification for Microsoft 365 is unaffected regardless: it runs over the HTTPS
          GetCredentialType API, not SMTP.
        </p>
      </SectionCard>
    </div>
  );
}

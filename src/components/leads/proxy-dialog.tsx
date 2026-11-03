"use client";
import { ColHead } from "@/components/common/col-head";
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, ShieldCheck, ShieldAlert, Shuffle, ExternalLink, Play } from "lucide-react";
import Link from "next/link";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IconTile, Pill } from "@/components/common/kit";
import { testProxy, type ProxyStatus } from "@/lib/api/client";

/**
 * Proxy pool config + test. The crawl uses a rotating proxy (Layer 1) and falls
 * back to Decodo (Layer 2) only when every rotated IP is blocked. This dialog
 * checks the pool is still valid (list downloads → plan active) and probes a
 * sample of IPs so you know it still works before crawling.
 */
export function ProxyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [status, setStatus] = React.useState<ProxyStatus | null>(null);
  const test = useMutation({ mutationFn: testProxy, onSuccess: setStatus });

  // Auto-run the probe once when opened.
  React.useEffect(() => { if (open && !status && !test.isPending) test.mutate(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = status;
  const healthy = !!s && s.configured && s.reachable && s.working > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-lg">
      <DialogHeader className="space-y-3 pr-8">
        <IconTile icon={Shuffle} tone={!s ? "brand" : healthy ? "valid" : s.configured ? "invalid" : "risky"} />
        <div className="space-y-1">
          <DialogTitle className="text-base">Proxy pool</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">Layer 1 rotating proxy for crawling (Decodo is the Layer 2 fallback). Check it&rsquo;s still valid and usable.</DialogDescription>
        </div>
      </DialogHeader>

      <div className="space-y-3 py-1">
        {test.isPending && !s ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface/60 p-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-brand" strokeWidth={1.75} /> Testing proxies…
          </div>
        ) : test.isError ? (
          <div className="flex items-start gap-3 rounded-lg border border-[hsl(var(--invalid)/0.25)] bg-[hsl(var(--invalid)/0.06)] p-3 text-sm">
            <IconTile icon={ShieldAlert} tone="invalid" size="sm" />
            <span className="pt-1">Couldn&rsquo;t reach the crawler service to test the proxy.</span>
          </div>
        ) : !s ? null : !s.configured ? (
          <div className="flex items-start gap-3 rounded-lg border border-[hsl(var(--risky)/0.3)] bg-[hsl(var(--risky)/0.06)] p-3 text-sm">
            <IconTile icon={ShieldAlert} tone="risky" size="sm" />
            <span className="pt-1 leading-relaxed">No proxy configured. Crawls go direct then fall back to Decodo. Add a proxy list in Settings → Config for IP rotation.</span>
          </div>
        ) : (
          <>
            <div className={cn(
              "flex items-start gap-3 rounded-lg border p-3 text-sm",
              healthy ? "border-[hsl(var(--valid)/0.25)] bg-[hsl(var(--valid)/0.06)]"
                : "border-[hsl(var(--invalid)/0.25)] bg-[hsl(var(--invalid)/0.06)]",
            )}>
              <IconTile icon={healthy ? ShieldCheck : ShieldAlert} tone={healthy ? "valid" : "invalid"} size="sm" />
              <span className={cn("pt-1 font-medium leading-relaxed", healthy ? "text-[hsl(var(--valid))]" : "text-[hsl(var(--invalid))]")}>
                {!s.reachable
                  ? (s.error || "Proxy list won't download — the plan may be expired or the URL wrong.")
                  : healthy
                    ? `Working — ${s.working}/${s.tested} sampled IPs OK, ${s.total} in pool.`
                    : `Pool loaded (${s.total} IPs) but 0/${s.tested} sampled IPs responded — likely blocked or expired.`}
              </span>
            </div>

            {s.results.length > 0 && (
              <div className="max-h-48 overflow-auto scrollbar-thin rounded-lg border border-border bg-card">
                <table className="w-full border-collapse text-[13px]">
                  <thead className="sticky top-0 z-10 bg-surface/95 text-left backdrop-blur supports-[backdrop-filter]:bg-surface/85">
                    <tr className="border-b border-border text-[13px] font-normal text-muted-foreground">
                      <th className="px-3 py-3"><ColHead label="Proxy IP" /></th>
                      <th className="px-3 py-3"><ColHead label="Status" /></th>
                      <th className="px-3 py-3 text-right"><ColHead label="Latency" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.results.map((r) => (
                      <tr key={r.ip} className="border-b border-border transition-colors last:border-0 hover:bg-surface/60">
                        <td className="px-3 py-2 font-mono text-xs text-foreground/90">{r.ip}</td>
                        <td className="px-3 py-2">
                          <Pill tone={r.ok ? "valid" : "invalid"} dot className="normal-case">
                            {r.ok ? "OK" : (r.status ?? "fail")}
                          </Pill>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">{r.ms}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <DialogFooter>
        <Link href="/settings/config" className="mr-auto inline-flex items-center gap-1.5 self-center text-sm font-medium text-brand hover:underline">
          <ExternalLink className="size-3.5" strokeWidth={1.75} /> Configure proxy
        </Link>
        <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending ? <Loader2 className="animate-spin" /> : <Play />} Test again
        </Button>
        <Button onClick={() => onOpenChange(false)}>Done</Button>
      </DialogFooter>
    </Dialog>
  );
}

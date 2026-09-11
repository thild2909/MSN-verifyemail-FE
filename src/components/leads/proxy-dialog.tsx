"use client";
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, ShieldCheck, ShieldAlert, Shuffle, ExternalLink, Play } from "lucide-react";
import Link from "next/link";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Shuffle className="size-5 text-primary" /> Proxy pool</DialogTitle>
        <DialogDescription>Layer 1 rotating proxy for crawling (Decodo is the Layer 2 fallback). Check it&rsquo;s still valid and usable.</DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-1">
        {test.isPending && !s ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Testing proxies…</div>
        ) : test.isError ? (
          <div className="flex items-start gap-2 rounded-lg border border-[hsl(var(--invalid))]/30 bg-[hsl(var(--invalid))]/5 p-3 text-sm">
            <ShieldAlert className="mt-0.5 size-4 text-[hsl(var(--invalid))]" />
            <span>Couldn&rsquo;t reach the crawler service to test the proxy.</span>
          </div>
        ) : !s ? null : !s.configured ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <ShieldAlert className="mt-0.5 size-4 text-amber-600 dark:text-amber-400" />
            <span>No proxy configured. Crawls go direct then fall back to Decodo. Add a proxy list in Settings → Config for IP rotation.</span>
          </div>
        ) : (
          <>
            <div className={cn(
              "flex items-center gap-2 rounded-lg border p-3 text-sm font-medium",
              healthy ? "border-[hsl(var(--valid))]/30 bg-[hsl(var(--valid))]/5 text-[hsl(var(--valid))]"
                : "border-[hsl(var(--invalid))]/30 bg-[hsl(var(--invalid))]/5 text-[hsl(var(--invalid))]",
            )}>
              {healthy ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
              {!s.reachable
                ? (s.error || "Proxy list won't download — the plan may be expired or the URL wrong.")
                : healthy
                  ? `Working — ${s.working}/${s.tested} sampled IPs OK, ${s.total} in pool.`
                  : `Pool loaded (${s.total} IPs) but 0/${s.tested} sampled IPs responded — likely blocked or expired.`}
            </div>

            {s.results.length > 0 && (
              <div className="max-h-44 overflow-auto scrollbar-thin rounded-lg border">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-card text-left text-muted-foreground">
                    <tr className="border-b"><th className="px-3 py-1.5">Proxy IP</th><th className="px-3 py-1.5">Status</th><th className="px-3 py-1.5 text-right">Latency</th></tr>
                  </thead>
                  <tbody>
                    {s.results.map((r) => (
                      <tr key={r.ip} className="border-b last:border-0">
                        <td className="px-3 py-1.5 font-mono text-xs">{r.ip}</td>
                        <td className="px-3 py-1.5">
                          <span className={cn("rounded-full px-1.5 py-0.5 text-[11px] font-semibold", r.ok ? "bg-[hsl(var(--valid))]/12 text-[hsl(var(--valid))]" : "bg-[hsl(var(--invalid))]/12 text-[hsl(var(--invalid))]")}>
                            {r.ok ? "OK" : (r.status ?? "fail")}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.ms}ms</td>
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
        <Link href="/settings/config" className="mr-auto inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ExternalLink className="size-3.5" /> Configure proxy
        </Link>
        <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Test again
        </Button>
        <Button onClick={() => onOpenChange(false)}>Done</Button>
      </DialogFooter>
    </Dialog>
  );
}

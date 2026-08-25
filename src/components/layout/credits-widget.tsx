"use client";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Zap, RotateCcw, Loader2 } from "lucide-react";
import { getCredits, resetCredits } from "@/lib/api/client";
import { formatNumber } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

function Meter({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-sidebar-muted">{label}</span>
        <span className="font-medium text-sidebar-foreground">
          {formatNumber(value)} / {formatNumber(max)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-sidebar-border">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: tone }} />
      </div>
    </div>
  );
}

export function CreditsWidget() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["credits"], queryFn: getCredits });

  const reset = useMutation({
    mutationFn: resetCredits,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credits"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast({ variant: "success", title: "Credits reset", description: "Your balance is back to unused." });
    },
    onError: () => toast({ variant: "error", title: "Could not reset credits" }),
  });

  return (
    <div className="rounded-xl border border-sidebar-border bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-sidebar-accent" />
          <span className="text-sm font-semibold text-sidebar-foreground">Credits</span>
        </div>
        {data && (
          <span className="text-sm font-bold text-sidebar-foreground">
            {formatNumber(data.totalRemaining)}
            <span className="text-xs font-normal text-sidebar-muted"> / {formatNumber(data.totalAllocation)}</span>
          </span>
        )}
      </div>

      {isLoading || !data ? (
        <div className="space-y-3">
          <div className="h-1.5 w-full rounded-full bg-sidebar-border" />
          <div className="h-1.5 w-full rounded-full bg-sidebar-border" />
        </div>
      ) : (
        <div className="space-y-3">
          <Meter label="Verification" value={data.verificationRemaining} max={data.verificationAllocation} tone="hsl(243 75% 63%)" />
          <Meter label="Pay-as-you-go" value={data.payAsYouGoRemaining} max={data.payAsYouGoAllocation} tone="hsl(142 71% 45%)" />
        </div>
      )}

      <Link
        href="/billing"
        className="mt-4 block rounded-lg bg-sidebar-accent px-3 py-2 text-center text-xs font-semibold text-white transition-opacity hover:opacity-90"
      >
        Add credits
      </Link>

      <button
        onClick={() => reset.mutate()}
        disabled={reset.isPending}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-center text-[11px] font-medium text-sidebar-muted transition-colors hover:bg-white/5 hover:text-sidebar-foreground disabled:opacity-50"
      >
        {reset.isPending ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
        Reset to unused
      </button>
    </div>
  );
}

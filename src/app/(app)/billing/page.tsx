"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Zap, Wallet, TrendingUp, TrendingDown, Check, RotateCcw, Loader2, Sparkles, ShieldCheck,
  Search, Code2, ScanSearch, Layers, MailCheck, CircleDot, ArrowUpRight, Receipt, Inbox,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { getCredits, getTransactions, resetCredits } from "@/lib/api/client";
import { CREDIT_COSTS } from "@/lib/credit-config";
import type { CreditBalance, CreditTransaction } from "@/lib/types";
import { cn, formatNumber, formatDateTime } from "@/lib/utils";

const PACKS = [
  { credits: 10000, price: 29 },
  { credits: 50000, price: 99, popular: true },
  { credits: 200000, price: 299 },
];

const COSTS: { label: string; cost: number; unit: string; icon: React.ElementType; tone: string }[] = [
  { label: "Single verification", cost: CREDIT_COSTS.single_verification, unit: "per email", icon: MailCheck, tone: "brand" },
  { label: "Bulk verification", cost: CREDIT_COSTS.bulk_verification, unit: "per email", icon: Layers, tone: "valid" },
  { label: "Deep Scan", cost: CREDIT_COSTS.deep_scan, unit: "per email", icon: ScanSearch, tone: "risky" },
  { label: "Email Finder", cost: CREDIT_COSTS.email_finder, unit: "per result", icon: Search, tone: "violet" },
  { label: "API verification", cost: CREDIT_COSTS.api_verification, unit: "per request", icon: Code2, tone: "sky" },
];

/** Tinted icon chip colours, shared by the summary strip, balance rows and cost list. */
const TONE: Record<string, string> = {
  brand: "bg-brand/10 text-brand",
  valid: "bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]",
  invalid: "bg-[hsl(var(--invalid)/0.12)] text-[hsl(var(--invalid))]",
  risky: "bg-[hsl(var(--risky)/0.14)] text-[hsl(var(--risky))]",
  violet: "bg-[hsl(280_70%_60%/0.12)] text-[hsl(280_65%_55%)] dark:text-[hsl(280_80%_75%)]",
  sky: "bg-[hsl(199_89%_48%/0.12)] text-[hsl(199_89%_40%)] dark:text-[hsl(199_90%_65%)]",
};

function Chip({ icon: Icon, tone, className }: { icon: React.ElementType; tone: string; className?: string }) {
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", TONE[tone], className)}>
      <Icon className="size-4" strokeWidth={1.75} />
    </span>
  );
}

/** First day of next month, the renewal date of the monthly verification allocation. */
function nextRenewal(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function pct(part: number, whole: number) {
  return whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0;
}

/* ------------------------------ summary strip ----------------------------- */

function SummaryStrip({ credits, txns }: { credits: CreditBalance; txns: CreditTransaction[] }) {
  const spent = txns.filter((t) => t.credits < 0).reduce((s, t) => s - t.credits, 0);
  const items = [
    { label: "Total remaining", value: formatNumber(credits.totalRemaining), icon: Wallet, tone: "brand", valueClass: "text-foreground" },
    { label: "Verification", value: formatNumber(credits.verificationRemaining), icon: Zap, tone: "risky", valueClass: "text-foreground" },
    { label: "Pay-as-you-go", value: formatNumber(credits.payAsYouGoRemaining), icon: TrendingUp, tone: "valid", valueClass: "text-foreground" },
    { label: "Used to date", value: formatNumber(spent), icon: TrendingDown, tone: "invalid", valueClass: spent > 0 ? "text-[hsl(var(--invalid))]" : "text-foreground" },
    { label: "Renews", value: nextRenewal(), icon: CircleDot, tone: "sky", valueClass: "text-[hsl(var(--valid))]" },
  ];
  return (
    <Card className="grid grid-cols-2 divide-border sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
          <Chip icon={it.icon} tone={it.tone} />
          <div className="min-w-0">
            <p className="truncate text-[13px] text-muted-foreground">{it.label}</p>
            <p className={cn("truncate text-[15px] font-semibold tabular-nums", it.valueClass)}>{it.value}</p>
          </div>
        </div>
      ))}
    </Card>
  );
}

/* ------------------------------ balance card ------------------------------ */

/** Status pill driven by how much of the total is left. */
function balanceStatus(leftPct: number) {
  if (leftPct <= 10) return { label: "Critical", dot: "bg-[hsl(var(--invalid))]", text: "text-[hsl(var(--invalid))]", bg: "bg-[hsl(var(--invalid)/0.1)]" };
  if (leftPct <= 25) return { label: "Running low", dot: "bg-[hsl(var(--risky))]", text: "text-[hsl(var(--risky))]", bg: "bg-[hsl(var(--risky)/0.12)]" };
  return { label: "Healthy", dot: "bg-[hsl(var(--valid))]", text: "text-[hsl(var(--valid))]", bg: "bg-[hsl(var(--valid)/0.12)]" };
}

function BalanceCard({ credits, onBuy }: { credits: CreditBalance; onBuy: () => void }) {
  const total = credits.totalAllocation;
  const leftPct = pct(credits.totalRemaining, total);
  const used = Math.max(0, total - credits.totalRemaining);
  const status = balanceStatus(leftPct);

  const pools = [
    {
      key: "verification",
      label: "Monthly verification",
      note: `Refills ${nextRenewal()}`,
      icon: Zap,
      remaining: credits.verificationRemaining,
      allocation: credits.verificationAllocation,
      color: "hsl(var(--brand))",
      chip: "bg-brand/10 text-brand",
    },
    {
      key: "payg",
      label: "Pay-as-you-go",
      note: "Never expires",
      icon: TrendingUp,
      remaining: credits.payAsYouGoRemaining,
      allocation: credits.payAsYouGoAllocation,
      color: "hsl(var(--valid))",
      chip: "bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]",
    },
  ];

  return (
    <Card className="flex flex-col p-5 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Chip icon={Wallet} tone="brand" />
          <div>
            <p className="text-[15px] font-semibold leading-tight">Credit balance</p>
            <p className="text-xs text-muted-foreground">Monthly + pay-as-you-go pools</p>
          </div>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold", status.bg, status.text)}>
          <span className={cn("size-1.5 rounded-full", status.dot)} />
          {status.label}
        </span>
      </div>

      {/* Headline: credits left, with used alongside */}
      <div className="mt-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Available now</p>
          <p className="mt-1 text-[2rem] font-semibold leading-none tracking-tight tabular-nums">{formatNumber(credits.totalRemaining)}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            of <span className="tabular-nums">{formatNumber(total)}</span> credits · <span className="tabular-nums">{Math.round(leftPct)}%</span> left
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium text-muted-foreground">Used</p>
          <p className={cn("mt-1 text-lg font-semibold tabular-nums", used > 0 ? "text-foreground" : "text-muted-foreground")}>{formatNumber(used)}</p>
        </div>
      </div>

      {/* Stacked bar: each pool's remaining share of the total, used = track */}
      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-border" role="img" aria-label={`${Math.round(leftPct)}% of credits left`}>
        {pools.map((p) => (
          <div key={p.key} className="h-full transition-all first:rounded-l-full" style={{ width: `${pct(p.remaining, total)}%`, background: p.color }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {pools.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: p.color }} /> {p.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-border" /> Used</span>
      </div>

      {/* Pool tiles */}
      <div className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {pools.map((p) => {
          const poolLeft = pct(p.remaining, p.allocation);
          return (
            <div key={p.key} className="rounded-lg border border-border bg-surface/50 p-3">
              <div className="flex items-center gap-2">
                <span className={cn("flex size-6 items-center justify-center rounded-md", p.chip)}>
                  <p.icon className="size-3.5" strokeWidth={1.75} />
                </span>
                <span className="truncate text-[13px] font-medium">{p.label}</span>
              </div>
              <p className="mt-2.5 text-base font-semibold tabular-nums">
                {formatNumber(p.remaining)}
                <span className="text-xs font-normal text-muted-foreground"> / {formatNumber(p.allocation)}</span>
              </p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border">
                <div className="h-full rounded-full transition-all" style={{ width: `${poolLeft}%`, background: p.color }} />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">{p.note}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-auto pt-5">
        <Button variant="outline" className="w-full" onClick={onBuy}><Zap /> Buy pay-as-you-go credits</Button>
      </div>
    </Card>
  );
}

/* -------------------------------- plan card ------------------------------- */

function PlanCard({ onBuy }: { onBuy: () => void }) {
  return (
    <Card className="flex flex-col p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Chip icon={Sparkles} tone="brand" />
          <div>
            <p className="text-[15px] font-semibold leading-tight">Current plan</p>
            <p className="text-xs text-muted-foreground">Renews {nextRenewal()}</p>
          </div>
        </div>
        <span className="rounded-md bg-[hsl(var(--valid)/0.12)] px-2 py-0.5 text-xs font-semibold text-[hsl(var(--valid))]">Active</span>
      </div>

      <div className="mt-5">
        <p className="text-2xl font-semibold tracking-tight">Growth</p>
        <p className="mt-1 text-sm text-muted-foreground">25,000 verification credits every month, plus pay-as-you-go top-ups that never expire.</p>
      </div>

      <ul className="mt-5 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {["Bulk verification", "Deep Scan", "Email Finder", "API access", "Webhooks", "Blacklist monitor"].map((f) => (
          <li key={f} className="flex items-center gap-2">
            <span className="flex size-4 items-center justify-center rounded-full bg-[hsl(var(--valid)/0.14)]">
              <Check className="size-3 text-[hsl(var(--valid))]" strokeWidth={2.5} />
            </span>
            {f}
          </li>
        ))}
      </ul>

      <div className="mt-auto flex gap-2 pt-6">
        <Button variant="outline" className="flex-1">Manage plan</Button>
        <Button variant="brand" className="flex-1" onClick={onBuy}><Zap /> Top up</Button>
      </div>
    </Card>
  );
}

/* -------------------------------- cost card ------------------------------- */

function CostCard() {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <Chip icon={Receipt} tone="risky" />
        <div>
          <p className="text-[15px] font-semibold leading-tight">Credit costs</p>
          <p className="text-xs text-muted-foreground">What each operation consumes</p>
        </div>
      </div>
      <ul className="mt-4 divide-y divide-border">
        {COSTS.map((c) => (
          <li key={c.label} className="flex items-center gap-3 py-2.5">
            <span className={cn("flex size-7 items-center justify-center rounded-lg", TONE[c.tone])}>
              <c.icon className="size-3.5" strokeWidth={1.75} />
            </span>
            <span className="flex-1 text-sm">{c.label}</span>
            <span className="text-sm font-semibold tabular-nums">{c.cost}</span>
            <span className="w-24 text-right text-xs text-muted-foreground">credit{c.cost > 1 ? "s" : ""} {c.unit}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-dashed border-border bg-surface/60 px-3 py-2.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-px size-3.5 shrink-0 text-[hsl(var(--valid))]" />
        Pricing is served from backend configuration, never hard-coded in the client.
      </div>
    </Card>
  );
}

/* ------------------------------ history card ------------------------------ */

type Filter = "all" | "spent" | "added";

function HistoryCard({ txns, loading }: { txns: CreditTransaction[]; loading: boolean }) {
  const [filter, setFilter] = React.useState<Filter>("all");
  const rows = txns.filter((t) => (filter === "all" ? true : filter === "spent" ? t.credits < 0 : t.credits > 0));

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="text-[15px] font-semibold">Credit history</p>
          <p className="text-xs text-muted-foreground">Every top-up and charge on this workspace</p>
        </div>
        <div className="inline-flex self-start rounded-lg border border-border bg-surface p-0.5 sm:self-auto">
          {(["all", "spent", "added"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-3 py-1 text-[13px] font-medium capitalize transition-colors",
                filter === f ? "bg-card text-brand shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 px-5 pb-5 sm:px-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 border-t border-border px-6 py-12 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-surface text-muted-foreground"><Inbox className="size-5" strokeWidth={1.75} /></span>
          <p className="text-sm font-medium">No transactions yet</p>
          <p className="text-xs text-muted-foreground">Charges and top-ups will appear here.</p>
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-2 border-t border-border p-3 md:hidden">
            {rows.map((t) => (
              <div key={t.id} className="rounded-xl border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-sm font-medium">{t.label}</p>
                  <Amount value={t.credits} />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate">{formatDateTime(t.date)} · {t.user}</span>
                  <span className="shrink-0 tabular-nums">Bal {formatNumber(t.balance)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden border-t border-border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Date</TableHead>
                  <TableHead>Operation</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="pr-6">User</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap pl-6 text-muted-foreground">{formatDateTime(t.date)}</TableCell>
                    <TableCell className="font-medium">{t.label}</TableCell>
                    <TableCell className="text-right"><Amount value={t.credits} /></TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(t.balance)}</TableCell>
                    <TableCell className="pr-6 text-muted-foreground">{t.user}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </Card>
  );
}

function Amount({ value }: { value: number }) {
  const neg = value < 0;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[13px] font-semibold tabular-nums",
        neg ? "bg-[hsl(var(--invalid)/0.1)] text-[hsl(var(--invalid))]" : "bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]",
      )}
    >
      {value > 0 ? "+" : ""}{formatNumber(value)}
    </span>
  );
}

/* ---------------------------------- page ---------------------------------- */

export default function BillingPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const { data: credits, isLoading } = useQuery({ queryKey: ["credits"], queryFn: getCredits });
  const { data: txns, isLoading: txLoading } = useQuery({ queryKey: ["transactions"], queryFn: getTransactions });
  const [buyOpen, setBuyOpen] = React.useState(false);
  const [pack, setPack] = React.useState(PACKS[1]);

  const reset = useMutation({
    mutationFn: resetCredits,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credits"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast({ variant: "success", title: "Credits reset", description: "Your balance is back to unused." });
    },
    onError: () => toast({ variant: "error", title: "Could not reset credits" }),
  });

  const onReset = async () => {
    const ok = await confirm({
      title: "Reset credits to unused?",
      description: "Every pool is refilled to its allocation and the credit history is cleared.",
      confirmText: "Reset credits",
      destructive: true,
    });
    if (ok) reset.mutate();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing & credits"
        subtitle="Track balances, top up, and review your usage history."
        actions={
          <>
            <Button variant="brand" onClick={onReset} disabled={reset.isPending}>
              {reset.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reset
            </Button>
            <Button onClick={() => setBuyOpen(true)}><Zap /> Add credits</Button>
          </>
        }
      />

      {isLoading || !credits ? (
        <>
          <Skeleton className="h-[72px] w-full rounded-xl" />
          <div className="grid gap-5 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[420px] w-full rounded-xl" />)}
          </div>
        </>
      ) : (
        <>
          <SummaryStrip credits={credits} txns={txns ?? []} />
          <div className="grid gap-5 lg:grid-cols-3">
            <BalanceCard credits={credits} onBuy={() => setBuyOpen(true)} />
            <PlanCard onBuy={() => setBuyOpen(true)} />
            <CostCard />
          </div>
        </>
      )}

      <HistoryCard txns={txns ?? []} loading={txLoading} />

      {/* Buy dialog */}
      <Dialog open={buyOpen} onOpenChange={setBuyOpen}>
        <DialogHeader>
          <DialogTitle>Add credits</DialogTitle>
          <DialogDescription>Pay-as-you-go credits never expire.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          {PACKS.map((p) => {
            const selected = pack.credits === p.credits;
            return (
              <button
                key={p.credits}
                onClick={() => setPack(p)}
                className={cn(
                  "relative rounded-xl border bg-card p-4 text-left transition-all",
                  selected ? "border-brand ring-[3px] ring-brand/15" : "border-border hover:border-brand/40",
                )}
              >
                {p.popular && (
                  <span className="absolute -top-2.5 right-3 rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-white">Popular</span>
                )}
                <p className="text-lg font-semibold tabular-nums">{formatNumber(p.credits)}</p>
                <p className="text-xs text-muted-foreground">credits</p>
                <div className="mt-3 flex items-baseline justify-between">
                  <span className="text-base font-semibold">${p.price}</span>
                  <span className="text-[11px] text-muted-foreground">${((p.price / p.credits) * 1000).toFixed(2)}/1k</span>
                </div>
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setBuyOpen(false)}>Cancel</Button>
          <Button
            onClick={() => {
              setBuyOpen(false);
              toast({ variant: "success", title: "Credits added", description: `${formatNumber(pack.credits)} credits purchased.` });
            }}
          >
            Pay ${pack.price} <ArrowUpRight />
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

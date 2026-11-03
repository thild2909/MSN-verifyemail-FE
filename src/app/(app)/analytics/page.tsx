"use client";
import { ColHead } from "@/components/common/col-head";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Mail, CheckCircle2, XCircle, AlertTriangle, Zap, BarChart3, Table2, Globe, PieChart, RefreshCw,
  ArrowUpRight, ArrowDownRight, Minus, Hourglass, ListChecks, MailCheck, Info,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { IconTile, SectionCard, type Tone } from "@/components/common/kit";
import { VolumeChart, CreditsChart, SERIES, shortDate } from "@/components/analytics/charts";
import { getAnalytics } from "@/lib/api/client";
import { CREDIT_COSTS } from "@/lib/credit-config";
import type { AnalyticsBuckets, AnalyticsReport } from "@/lib/types";
import { cn, formatNumber } from "@/lib/utils";

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

/** Share of `part` in `whole` as a percentage, or null when there is nothing to divide. */
function rate(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

function fmtPct(v: number | null, digits = 1) {
  return v == null ? "—" : `${v.toFixed(digits)}%`;
}

function fmtWhen(iso: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return null;
  }
}

/* --------------------------------- delta ---------------------------------- */

/**
 * Change vs the previous equal-length period. `kind: "count"` shows a relative
 * %; `kind: "rate"` shows percentage points. `goodWhen` sets the colour.
 */
function Delta({
  now, before, kind, goodWhen = "up",
}: { now: number | null; before: number | null; kind: "count" | "rate"; goodWhen?: "up" | "down" }) {
  if (now == null || before == null) return <span className="text-[11px] text-muted-foreground">No prior data</span>;
  const diff = kind === "rate" ? now - before : before === 0 ? (now === 0 ? 0 : Infinity) : ((now - before) / before) * 100;
  if (diff === 0 || Math.abs(diff) < 0.05) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground">
        <Minus className="size-3" /> No change
      </span>
    );
  }
  const up = diff > 0;
  const good = goodWhen === "up" ? up : !up;
  const label = !isFinite(diff) ? "New" : kind === "rate" ? `${Math.abs(diff).toFixed(1)} pts` : `${Math.abs(diff).toFixed(0)}%`;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1 py-px text-[11px] font-semibold",
        good ? "bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]" : "bg-[hsl(var(--invalid)/0.1)] text-[hsl(var(--invalid))]",
      )}
    >
      <Icon className="size-3" /> {label}
    </span>
  );
}

/* ---------------------------------- KPIs ---------------------------------- */

function Kpis({ r }: { r: AnalyticsReport }) {
  const t = r.totals;
  const p = r.previous;
  const cur = { valid: rate(t.valid, t.total), invalid: rate(t.invalid, t.total), risky: rate(t.risky + t.unknown, t.total) };
  const prv = { valid: rate(p.valid, p.total), invalid: rate(p.invalid, p.total), risky: rate(p.risky + p.unknown, p.total) };

  // Ledger is the source of truth for credits; when it has no charges for the
  // window, show the cost implied by the verifications (clearly marked "est.").
  const estimated = t.creditsSpent === 0 && t.total > 0;
  const credits = estimated ? t.total * CREDIT_COSTS.bulk_verification : t.creditsSpent;

  const items: { label: string; value: string; icon: React.ElementType; tone: Tone; valueClass?: string; delta: React.ReactNode; sub?: string }[] = [
    {
      label: "Emails verified",
      value: formatNumber(t.total),
      icon: Mail,
      tone: "brand",
      delta: <Delta now={t.total} before={p.total} kind="count" />,
    },
    {
      label: "Valid rate",
      value: fmtPct(cur.valid),
      icon: CheckCircle2,
      tone: "valid",
      valueClass: cur.valid != null ? "text-[hsl(var(--valid))]" : undefined,
      delta: <Delta now={cur.valid} before={prv.valid} kind="rate" />,
      sub: `${formatNumber(t.valid)} valid`,
    },
    {
      label: "Invalid rate",
      value: fmtPct(cur.invalid),
      icon: XCircle,
      tone: "invalid",
      valueClass: cur.invalid != null ? "text-[hsl(var(--invalid))]" : undefined,
      delta: <Delta now={cur.invalid} before={prv.invalid} kind="rate" goodWhen="down" />,
      sub: `${formatNumber(t.invalid)} invalid`,
    },
    {
      label: "Risky + unknown",
      value: fmtPct(cur.risky),
      icon: AlertTriangle,
      tone: "risky",
      delta: <Delta now={cur.risky} before={prv.risky} kind="rate" goodWhen="down" />,
      sub: `${formatNumber(t.risky + t.unknown)} need review`,
    },
    {
      label: estimated ? "Credits used (est.)" : "Credits used",
      value: formatNumber(credits),
      icon: Zap,
      tone: "violet",
      delta: estimated ? (
        <span className="text-[11px] text-muted-foreground">{CREDIT_COSTS.bulk_verification} per verification</span>
      ) : (
        <Delta now={t.creditsSpent} before={p.creditsSpent} kind="count" goodWhen="down" />
      ),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {items.map((k, i) => (
        <Card key={k.label} className={cn("p-4", i === 0 && "col-span-2 md:col-span-1")}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-medium text-foreground/85">{k.label}</p>
            <IconTile icon={k.icon} tone={k.tone} size="sm" className="rounded-full" />
          </div>
          <p className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", k.valueClass)}>{k.value}</p>
          <div className="mt-1.5 flex min-h-[18px] flex-wrap items-center gap-1.5">
            {k.delta}
            {k.sub && <span className="text-[11px] text-muted-foreground">{k.sub}</span>}
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------ volume card ------------------------------- */

function Legend({ totals }: { totals: AnalyticsBuckets }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
      {SERIES.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
          {s.label}
          <span className="font-semibold tabular-nums text-foreground">{formatNumber(totals[s.key])}</span>
        </span>
      ))}
    </div>
  );
}

function VolumeCard({ r }: { r: AnalyticsReport }) {
  const [view, setView] = React.useState<"chart" | "table">("chart");
  const empty = r.totals.total === 0;
  const peak = r.series.reduce((m, p) => (p.total > m.total ? p : m), r.series[0]);
  const activeDays = r.series.filter((p) => p.total > 0).length;

  return (
    <SectionCard
      icon={BarChart3}
      title="Verification volume"
      description={`Daily results · ${shortDate(r.range.from)} – ${shortDate(r.range.to)}`}
      aside={
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5" role="tablist" aria-label="View">
          {([
            { v: "chart" as const, icon: BarChart3, label: "Chart" },
            { v: "table" as const, icon: Table2, label: "Table" },
          ]).map((o) => (
            <button
              key={o.v}
              role="tab"
              aria-selected={view === o.v}
              onClick={() => setView(o.v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
                view === o.v ? "bg-card text-brand shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <o.icon className="size-3.5" /> {o.label}
            </button>
          ))}
        </div>
      }
    >
      {empty ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <IconTile icon={MailCheck} tone="muted" />
          <p className="text-sm font-medium">No verifications in this period</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Results appear here as soon as a list finishes verifying. Upload a list or widen the date range.
          </p>
          <Link href="/verification" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2")}>
            <MailCheck /> Verify a list
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <Legend totals={r.totals} />
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span>Active days <span className="font-semibold tabular-nums text-foreground">{activeDays}/{r.series.length}</span></span>
              {peak && peak.total > 0 && (
                <span>Peak <span className="font-semibold tabular-nums text-foreground">{formatNumber(peak.total)}</span> on {shortDate(peak.date)}</span>
              )}
            </div>
          </div>
          {view === "chart" ? (
            <VolumeChart data={r.series} />
          ) : (
            <div className="max-h-[300px] overflow-auto rounded-lg border border-border scrollbar-thin">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left text-[13px] font-normal text-muted-foreground">
                    <th className="px-3 py-3"><ColHead label="Date" /></th>
                    {SERIES.map((s) => <th key={s.key} className="px-3 py-3 text-right"><ColHead label={s.label} /></th>)}
                    <th className="px-3 py-3 text-right"><ColHead label="Total" /></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[...r.series].reverse().map((p) => (
                    <tr key={p.date} className={cn(p.total === 0 && "text-muted-foreground")}>
                      <td className="whitespace-nowrap px-3 py-1.5">{shortDate(p.date)}</td>
                      {SERIES.map((s) => <td key={s.key} className="px-3 py-1.5 text-right tabular-nums">{formatNumber(p[s.key])}</td>)}
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{formatNumber(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

/* ---------------------------- breakdown card ------------------------------ */

function BreakdownCard({ r }: { r: AnalyticsReport }) {
  const t = r.totals;
  return (
    <SectionCard icon={PieChart} tone="sky" title="Result breakdown" description="Share of each verdict in this period">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums">{formatNumber(t.total)}</span>
        <span className="text-sm text-muted-foreground">verified</span>
      </div>
      <div className="mt-4 flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-border" role="img" aria-label="Result composition">
        {t.total > 0 &&
          SERIES.map((s) => {
            const w = (t[s.key] / t.total) * 100;
            return w > 0 ? <div key={s.key} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${w}%`, background: s.color }} /> : null;
          })}
      </div>
      <ul className="mt-4 space-y-2.5">
        {[...SERIES].map((s) => (
          <li key={s.key} className="flex items-center gap-2.5 text-sm">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
            <span className="flex-1">{s.label}</span>
            <span className="font-semibold tabular-nums">{formatNumber(t[s.key])}</span>
            <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{fmtPct(rate(t[s.key], t.total))}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-4">
        <div className="rounded-lg bg-surface/60 p-2.5">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><ListChecks className="size-3.5" /> Lists created</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">{formatNumber(t.listsCreated)}</p>
        </div>
        <div className="rounded-lg bg-surface/60 p-2.5">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Hourglass className="size-3.5" /> Awaiting check</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums">{formatNumber(r.pending)}</p>
        </div>
      </div>
    </SectionCard>
  );
}

/* ------------------------------ domains card ------------------------------ */

function DomainsCard({ r }: { r: AnalyticsReport }) {
  const max = r.domains.reduce((m, d) => Math.max(m, d.total), 0);
  return (
    <SectionCard icon={Globe} tone="violet" title="Top domains" description="Most-verified recipient domains" bodyClassName="p-0">
      {r.domains.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-muted-foreground">No domains in this period.</p>
      ) : (
        <ul className="divide-y divide-border">
          {r.domains.map((d) => (
            <li key={d.domain} className="px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{d.domain}</span>
                <span className="tabular-nums text-muted-foreground">{formatNumber(d.total)}</span>
                <span
                  className={cn(
                    "w-14 text-right text-xs font-semibold tabular-nums",
                    d.validRate >= 80 ? "text-[hsl(var(--valid))]" : d.validRate >= 50 ? "text-foreground" : "text-[hsl(var(--invalid))]",
                  )}
                  title="Valid rate"
                >
                  {d.validRate.toFixed(0)}%
                </span>
              </div>
              {/* Bar length = volume relative to the top domain; segments = verdict mix. */}
              <div className="mt-1.5 flex h-1.5 gap-px overflow-hidden rounded-full" style={{ width: `${max > 0 ? Math.max(6, (d.total / max) * 100) : 0}%` }}>
                {SERIES.map((s) => (d[s.key] > 0 ? <div key={s.key} className="h-full" style={{ flexGrow: d[s.key], background: s.color }} /> : null))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ------------------------------ credits card ------------------------------ */

function CreditsCard({ r }: { r: AnalyticsReport }) {
  const t = r.totals;
  const hasLedger = t.creditsSpent > 0;
  return (
    <SectionCard
      icon={Zap}
      tone="brand"
      title="Credit consumption"
      description="Daily credits charged, from the credit ledger"
      aside={
        <div className="text-right">
          <p className="text-lg font-semibold leading-none tabular-nums">{formatNumber(t.creditsSpent)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">spent{t.creditsAdded > 0 ? ` · +${formatNumber(t.creditsAdded)} added` : ""}</p>
        </div>
      }
    >
      {hasLedger ? (
        <CreditsChart data={r.series} />
      ) : (
        <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-surface/50 p-4">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="text-sm">
            <p className="font-medium">No credit charges recorded in this period</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t.total > 0
                ? `At ${CREDIT_COSTS.bulk_verification} credit per email, the ${formatNumber(t.total)} verifications above correspond to about ${formatNumber(t.total * CREDIT_COSTS.bulk_verification)} credits.`
                : "Charges appear here once verifications are billed to the credit ledger."}{" "}
              <Link href="/billing" className="font-medium text-brand hover:underline">View billing</Link>
            </p>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/* ---------------------------------- page ---------------------------------- */

export default function AnalyticsPage() {
  const [days, setDays] = React.useState(30);
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["analytics", days],
    queryFn: () => getAnalytics(days),
    placeholderData: (prev) => prev, // keep the old range on screen while switching
    refetchInterval: 60_000,
  });

  const last = fmtWhen(data?.lastVerifiedAt ?? null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="Verification volume, result quality and credit consumption — computed from your stored results."
        actions={
          <>
            <div className="inline-flex rounded-lg border border-border bg-surface p-0.5" role="tablist" aria-label="Date range">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  role="tab"
                  aria-selected={days === r.days}
                  onClick={() => setDays(r.days)}
                  className={cn(
                    "rounded-md px-3 py-1 text-[13px] font-medium transition-colors",
                    days === r.days ? "bg-card text-brand shadow-xs" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh">
              <RefreshCw className={cn(isFetching && "animate-spin")} />
            </Button>
          </>
        }
      />

      {isError && !data ? (
        <Card className="flex items-start gap-3 border-[hsl(var(--invalid)/0.3)] p-5">
          <IconTile icon={AlertTriangle} tone="invalid" />
          <div className="text-sm">
            <p className="font-semibold">Could not load analytics</p>
            <p className="mt-0.5 text-muted-foreground">{error instanceof Error ? error.message : "Please try again."}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}><RefreshCw /> Retry</Button>
          </div>
        </Card>
      ) : isLoading || !data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[118px] w-full rounded-xl" />)}
          </div>
          <Skeleton className="h-[420px] w-full rounded-xl" />
        </>
      ) : (
        <div className={cn("space-y-6 transition-opacity", isFetching && "opacity-70")}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {shortDate(data.range.from)} – {shortDate(data.range.to)} · compared with the previous {data.range.days} days · {data.range.tz}
            </span>
            {last && <span>Last verification {last}</span>}
            {dataUpdatedAt > 0 && <span>Refreshed {new Date(dataUpdatedAt).toLocaleTimeString()}</span>}
          </div>

          <Kpis r={data} />
          <VolumeCard r={data} />

          <div className="grid gap-5 lg:grid-cols-3">
            <BreakdownCard r={data} />
            <DomainsCard r={data} />
            <CreditsCard r={data} />
          </div>
        </div>
      )}
    </div>
  );
}

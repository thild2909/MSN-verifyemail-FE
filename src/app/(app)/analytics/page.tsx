"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, CheckCircle2, XCircle, AlertTriangle, Zap, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { VolumeChart, CreditsChart } from "@/components/analytics/charts";
import { getAnalytics, getDomainStats } from "@/lib/api/client";
import { cn, formatNumber, formatPercent } from "@/lib/utils";

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

export default function AnalyticsPage() {
  const [days, setDays] = React.useState(30);
  const { data, isLoading } = useQuery({ queryKey: ["analytics", days], queryFn: () => getAnalytics(days) });
  const { data: domains } = useQuery({ queryKey: ["domainStats"], queryFn: getDomainStats });

  const totals = React.useMemo(() => {
    if (!data) return null;
    const sum = data.reduce(
      (a, p) => ({
        valid: a.valid + p.valid,
        invalid: a.invalid + p.invalid,
        risky: a.risky + p.risky,
        unknown: a.unknown + p.unknown,
        credits: a.credits + p.credits,
      }),
      { valid: 0, invalid: 0, risky: 0, unknown: 0, credits: 0 },
    );
    const total = sum.valid + sum.invalid + sum.risky + sum.unknown;
    return { ...sum, total };
  }, [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="Verification volume, quality trends, and credit consumption."
        actions={
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  days === r.days ? "bg-card shadow-sm" : "text-muted-foreground",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {isLoading || !totals ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Emails verified" value={totals.total} icon={Mail} />
          <StatCard label="Valid rate" value={formatPercent((totals.valid / totals.total) * 100)} icon={CheckCircle2} accent="valid" />
          <StatCard label="Invalid rate" value={formatPercent((totals.invalid / totals.total) * 100)} icon={XCircle} accent="invalid" />
          <StatCard label="Credits used" value={totals.credits} icon={Zap} />
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Verification volume</CardTitle></CardHeader>
        <CardContent>
          {data ? <VolumeChart data={data} /> : <Skeleton className="h-[300px] w-full" />}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Credit consumption</CardTitle></CardHeader>
          <CardContent>
            {data ? <CreditsChart data={data} /> : <Skeleton className="h-[260px] w-full" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Top domains</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(domains ?? []).map((d) => (
              <div key={d.domain}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{d.domain}</span>
                  <span className="text-muted-foreground">{formatNumber(d.total)}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-[hsl(var(--valid))]" style={{ width: `${d.validRate}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

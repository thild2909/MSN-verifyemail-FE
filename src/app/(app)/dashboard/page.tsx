"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Zap, ListChecks, Mail, CheckCircle2, Upload, Search } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendChart } from "@/components/analytics/charts";
import { ListsTable } from "@/components/verification/lists-table";
import { getCredits, getLists, getAnalytics } from "@/lib/api/client";
import { formatNumber } from "@/lib/utils";

export default function DashboardPage() {
  const { data: credits } = useQuery({ queryKey: ["credits"], queryFn: getCredits });
  const { data: lists } = useQuery({ queryKey: ["lists"], queryFn: getLists });
  const { data: series } = useQuery({ queryKey: ["analytics", 30], queryFn: () => getAnalytics(30) });

  const verified = series?.reduce((a, p) => a + p.valid + p.invalid + p.risky + p.unknown, 0) ?? 0;
  const valid = series?.reduce((a, p) => a + p.valid, 0) ?? 0;
  const validRate = verified ? Math.round((valid / verified) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle="Your verification activity at a glance."
        actions={
          <div className="flex gap-2">
            <Link href="/verification" className={buttonVariants({ variant: "outline" })}><Upload className="size-4" /> Upload</Link>
            <Link href="/finder" className={buttonVariants()}><Search className="size-4" /> Find emails</Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Credits remaining" value={credits?.totalRemaining ?? 0} hint={credits ? `of ${formatNumber(credits.totalAllocation)}` : ""} icon={Zap} />
        <StatCard label="Lists processed" value={lists?.length ?? 0} icon={ListChecks} />
        <StatCard label="Emails verified (30d)" value={verified} icon={Mail} />
        <StatCard label="Valid rate (30d)" value={`${validRate}%`} icon={CheckCircle2} accent="valid" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Valid vs invalid trend</CardTitle></CardHeader>
          <CardContent>{series ? <TrendChart data={series} /> : <Skeleton className="h-[220px] w-full" />}</CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Credits</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {credits ? (
              <>
                <div>
                  <p className="text-3xl font-bold">{formatNumber(credits.totalRemaining)}</p>
                  <p className="text-sm text-muted-foreground">of {formatNumber(credits.totalAllocation)} remaining</p>
                </div>
                <Meter label="Verification" value={credits.verificationRemaining} max={credits.verificationAllocation} />
                <Meter label="Pay-as-you-go" value={credits.payAsYouGoRemaining} max={credits.payAsYouGoAllocation} />
                <Link href="/billing" className={buttonVariants({ variant: "outline", size: "sm" }) + " w-full"}>Manage credits</Link>
              </>
            ) : (
              <Skeleton className="h-40 w-full" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent lists</CardTitle></CardHeader>
        <CardContent>{lists ? <ListsTable lists={lists} /> : <Skeleton className="h-40 w-full" />}</CardContent>
      </Card>
    </div>
  );
}

function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max ? (value / max) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{formatNumber(value)} / {formatNumber(max)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

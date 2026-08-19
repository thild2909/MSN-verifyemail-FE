"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Download, Sparkles, CheckCircle2, XCircle, AlertTriangle, HelpCircle, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/common/stat-card";
import { ResultsTable } from "@/components/verification/results-table";
import { getList } from "@/lib/api/client";
import { safeToSendRate } from "@/lib/types";
import { formatNumber, formatDate, cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

export default function ListDetailPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const { data: list, isLoading } = useQuery({
    queryKey: ["list", params.id],
    queryFn: () => getList(params.id),
    refetchInterval: (q) => {
      const l = q.state.data as { status?: string } | undefined;
      return l?.status === "processing" || l?.status === "queued" ? 2500 : false;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!list) {
    return (
      <div className="py-20 text-center">
        <p className="text-lg font-semibold">List not found</p>
        <Link href="/verification/lists" className={cn(buttonVariants({ variant: "outline" }), "mt-4")}>
          Back to lists
        </Link>
      </div>
    );
  }

  const rate = safeToSendRate(list.summary);
  const rateTone = rate >= 65 ? "bg-[hsl(var(--valid))]" : rate >= 45 ? "bg-[hsl(var(--risky))]" : "bg-[hsl(var(--invalid))]";

  return (
    <div className="space-y-6">
      {/* Breadcrumb + header */}
      <div>
        <Link href="/verification/lists" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Lists
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{list.name}</h1>
              <Badge variant={list.status === "completed" ? "success" : "warning"}>
                {list.status === "completed" ? "Completed" : "Processing"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {list.fileName} · {formatNumber(list.uniqueEmails)} unique emails · uploaded {formatDate(list.createdAt)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => toast({ variant: "info", title: "Deep scan queued", description: "Risky rows will be re-checked over SMTP." })}>
              <Sparkles className="size-4" /> Deep scan
            </Button>
            <Button onClick={() => toast({ variant: "success", title: "Export started", description: "Your cleaned list is being generated." })}>
              <Download className="size-4" /> Download
            </Button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total emails" value={list.summary.total} icon={Users} />
        <StatCard label="Valid" value={list.summary.valid} icon={CheckCircle2} accent="valid" />
        <StatCard label="Invalid" value={list.summary.invalid} icon={XCircle} accent="invalid" />
        <StatCard label="Risky" value={list.summary.risky} icon={AlertTriangle} accent="risky" />
        <StatCard label="Unknown" value={list.summary.unknown} icon={HelpCircle} accent="unknown" />
      </div>

      {/* Safe to send */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Safe to send</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <span className="text-3xl font-bold">{rate}%</span>
            <div className="flex-1">
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full transition-all", rateTone)} style={{ width: `${rate}%` }} />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {formatNumber(list.summary.valid)} of {formatNumber(list.summary.total)} addresses are verified deliverable.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verification results</CardTitle>
        </CardHeader>
        <CardContent>
          <ResultsTable listId={list.id} live={list.status === "processing" || list.status === "queued"} />
        </CardContent>
      </Card>
    </div>
  );
}

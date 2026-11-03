"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, CheckCircle2, XCircle, AlertTriangle, HelpCircle, Mail, ShieldCheck, ListChecks, FileSpreadsheet, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/page-header";
import { IconTile, Pill, SectionCard, type Tone } from "@/components/common/kit";
import { ResultsTable } from "@/components/verification/results-table";
import { DownloadMenu } from "@/components/verification/download-menu";
import { getList } from "@/lib/api/client";
import { safeToSendRate } from "@/lib/types";
import { formatNumber, formatDate, cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

/* Verdict buckets, in the order they're stacked (good → bad). */
const BUCKETS = [
  { key: "valid", label: "Valid", hint: "Deliverable", icon: CheckCircle2, tone: "valid", color: "hsl(var(--valid))" },
  { key: "risky", label: "Risky", hint: "Catch-all / role / disposable", icon: AlertTriangle, tone: "risky", color: "hsl(var(--risky))" },
  { key: "unknown", label: "Unknown", hint: "Server didn't confirm", icon: HelpCircle, tone: "muted", color: "hsl(var(--unknown))" },
  { key: "invalid", label: "Invalid", hint: "Will bounce", icon: XCircle, tone: "invalid", color: "hsl(var(--invalid))" },
] as const satisfies readonly { key: string; label: string; hint: string; icon: React.ElementType; tone: Tone; color: string }[];

function verdict(rate: number): { label: string; tone: Tone; color: string } {
  if (rate >= 65) return { label: "Good to send", tone: "valid", color: "hsl(var(--valid))" };
  if (rate >= 45) return { label: "Send with care", tone: "risky", color: "hsl(var(--risky))" };
  return { label: "Clean before sending", tone: "invalid", color: "hsl(var(--invalid))" };
}

/** Circular gauge for the safe-to-send rate. */
function Ring({ value, color }: { value: number; color: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" className="size-28 -rotate-90" role="img" aria-label={`${value}% safe to send`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="9" />
      <circle
        cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, Math.max(0, value)) / 100)}
        className="transition-[stroke-dashoffset] duration-700"
      />
    </svg>
  );
}

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
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
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

  const s = list.summary;
  const scored = s.valid + s.invalid + s.risky + s.unknown;
  const rate = safeToSendRate(s);
  const v = verdict(rate);
  const live = list.status === "processing" || list.status === "queued";
  const pct = (n: number) => (scored > 0 ? (n / scored) * 100 : 0);

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/verification/lists"
        title={list.name}
        status={
          live ? (
            <Pill tone="brand"><Loader2 className="size-3 animate-spin" /> {list.status === "queued" ? "Queued" : `Processing · ${list.progress}%`}</Pill>
          ) : (
            <Pill tone={list.status === "completed" ? "valid" : "risky"} dot>{list.status === "completed" ? "Completed" : list.status}</Pill>
          )
        }
        subtitle={`${list.fileName} · ${formatNumber(list.uniqueEmails)} unique emails · uploaded ${formatDate(list.createdAt)}`}
        actions={
          <>
            <Button variant="outline" onClick={() => toast({ variant: "info", title: "Deep scan queued", description: "Risky rows will be re-checked over SMTP." })}>
              <Sparkles /> Deep scan
            </Button>
            <DownloadMenu list={list} />
          </>
        }
      />

      {/* Overview: safe-to-send gauge + verdict breakdown */}
      <Card className="overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          {/* Gauge */}
          <div className="flex items-center gap-5 border-b border-border p-5 sm:p-6 lg:border-b-0 lg:border-r">
            <div className="relative shrink-0">
              <Ring value={rate} color={v.color} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-semibold leading-none tracking-tight tabular-nums">{rate}%</span>
                <span className="mt-1 text-[10px] font-medium text-muted-foreground">safe</span>
              </div>
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
                <ShieldCheck className="size-4" strokeWidth={1.75} /> Safe to send
              </p>
              <Pill tone={v.tone} className="mt-1.5 normal-case">{v.label}</Pill>
              <p className="mt-2 text-sm text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">{formatNumber(s.valid)}</span> of{" "}
                <span className="tabular-nums">{formatNumber(scored)}</span> checked addresses are deliverable.
              </p>
              {s.duplicates > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">{formatNumber(s.duplicates)} duplicate{s.duplicates === 1 ? "" : "s"} removed on upload.</p>
              )}
            </div>
          </div>

          {/* Breakdown */}
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="flex items-center gap-2 text-[15px] font-semibold">
                <IconTile icon={Mail} tone="brand" size="sm" /> Result breakdown
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">{formatNumber(s.total)}</span> emails
                {live && scored < s.total && <> · <span className="tabular-nums">{formatNumber(s.total - scored)}</span> still checking</>}
              </p>
            </div>

            {/* Composition bar */}
            <div className="mt-4 flex h-3 gap-[3px] overflow-hidden rounded-full bg-border" role="img" aria-label="Verdict composition">
              {scored > 0 &&
                BUCKETS.map((b) =>
                  s[b.key] > 0 ? <div key={b.key} className="h-full rounded-full transition-all" style={{ width: `${pct(s[b.key])}%`, background: b.color }} title={`${b.label}: ${formatNumber(s[b.key])}`} /> : null,
                )}
            </div>

            {/* Bucket tiles */}
            <div className="mt-4 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
              {BUCKETS.map((b) => {
                const n = s[b.key];
                const p = pct(n);
                return (
                  <div key={b.key} className="rounded-xl border border-border bg-surface/40 p-3">
                    <div className="flex items-center gap-2">
                      <IconTile icon={b.icon} tone={b.tone} size="sm" className="rounded-full" />
                      <span className="text-[13px] font-medium">{b.label}</span>
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">{p.toFixed(p > 0 && p < 10 ? 1 : 0)}%</span>
                    </div>
                    <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums">{formatNumber(n)}</p>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border">
                      <div className="h-full rounded-full" style={{ width: `${p}%`, background: b.color }} />
                    </div>
                    <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{b.hint}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* Results */}
      <SectionCard
        icon={ListChecks}
        tone="violet"
        title="Verification results"
        description="Every address with its verdict, score and checks."
        aside={
          <span className="inline-flex items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-xs text-muted-foreground">
            <FileSpreadsheet className="size-3.5" strokeWidth={1.75} /> {list.fileName}
          </span>
        }
      >
        <ResultsTable listId={list.id} live={live} />
      </SectionCard>
    </div>
  );
}

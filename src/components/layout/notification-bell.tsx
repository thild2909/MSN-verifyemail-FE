"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bell, ShieldAlert, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { DropdownMenu, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { getReputation } from "@/lib/api/client";
import type { ReputationStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type Severity = "critical" | "warning" | "info";
interface Note {
  id: string;
  severity: Severity;
  title: string;
  body: string;
  time: string | null;
}

/** Turn a reputation status into user-facing notifications. Healthy → none. */
function toNotes(s: ReputationStatus | null | undefined): Note[] {
  if (!s) return [];
  const notes: Note[] = [];
  const { summary } = s;

  if (summary.allBlocked) {
    notes.push({
      id: "all-blocked",
      severity: "critical",
      title: "All sending IPs are blocked",
      body: `Every egress IP is refused by ${s.refDomain} on reputation grounds (Spamhaus). SMTP verifications to strict providers will return “unknown”.`,
      time: s.checkedAt,
    });
  } else if (summary.anyBlocked && summary.clean === 1 && summary.total > 1) {
    notes.push({
      id: "low-headroom",
      severity: "warning",
      title: "Only 1 clean sending IP left",
      body: `${summary.blocked} of ${summary.total} IPs are blocked. One clean IP remains (${summary.cleanIps[0]}). Consider adding capacity before it too gets listed.`,
      time: s.checkedAt,
    });
  }

  for (const ip of s.ips.filter((r) => r.blocked)) {
    notes.push({
      id: `blocked-${ip.ip}`,
      severity: summary.allBlocked ? "critical" : "warning",
      title: `Sending IP blocked — ${ip.ip}`,
      body: ip.message?.trim()
        ? `Refused by ${ip.mx}: ${ip.message}`
        : `Refused by ${ip.mx} on reputation grounds (Spamhaus).`,
      time: ip.checkedAt,
    });
  }

  return notes;
}

const SEV_ICON: Record<Severity, React.ReactNode> = {
  critical: <ShieldAlert className="size-4 text-[hsl(var(--invalid))]" />,
  warning: <AlertTriangle className="size-4 text-[hsl(var(--risky))]" />,
  info: <CheckCircle2 className="size-4 text-primary" />,
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const secs = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function NotificationBell() {
  const { data, isLoading } = useQuery({
    queryKey: ["reputation"],
    queryFn: getReputation,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    staleTime: 60 * 1000,
    retry: false,
  });

  const notes = React.useMemo(() => toNotes(data), [data]);
  const hasAlerts = notes.length > 0;
  const worst: Severity | null = notes.some((n) => n.severity === "critical")
    ? "critical"
    : notes.some((n) => n.severity === "warning")
      ? "warning"
      : hasAlerts
        ? "info"
        : null;

  return (
    <DropdownMenu
      align="end"
      className="w-[22rem] p-0"
      trigger={
        <button className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Notifications">
          <Bell className="size-5" />
          {hasAlerts && (
            <span
              className={cn(
                "absolute right-1.5 top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white",
                worst === "critical" ? "bg-[hsl(var(--invalid))]" : worst === "warning" ? "bg-[hsl(var(--risky))]" : "bg-primary",
              )}
            >
              {notes.length}
            </span>
          )}
        </button>
      }
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-sm font-semibold">Notifications</span>
        {isLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </div>
      <DropdownSeparator />

      {notes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <CheckCircle2 className="size-6 text-[hsl(var(--valid))]" />
          <p className="text-sm font-medium">All clear</p>
          <p className="text-xs text-muted-foreground">
            {data?.summary.total
              ? `${data.summary.clean}/${data.summary.total} sending IPs healthy.`
              : "No delivery or reputation alerts right now."}
          </p>
        </div>
      ) : (
        <div className="max-h-[24rem] overflow-y-auto py-1">
          {notes.map((n) => (
            <div key={n.id} className="flex gap-2.5 px-3 py-2.5 hover:bg-accent">
              <div className="mt-0.5 shrink-0">{SEV_ICON[n.severity]}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-medium">{n.title}</p>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(n.time)}</span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{n.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <DropdownSeparator />
      <Link
        href="/blacklist"
        className="block px-3 py-2.5 text-center text-xs font-medium text-primary hover:underline"
      >
        Open Blacklist Monitor
      </Link>
    </DropdownMenu>
  );
}

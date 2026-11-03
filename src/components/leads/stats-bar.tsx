"use client";
import * as React from "react";
import { ChevronDown, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONES, type Tone } from "@/components/common/kit";

/**
 * Stats rail for the leads tabs. On md+ it's always shown (a wrapping row of
 * Stat chips), unchanged from before. On mobile it collapses behind a toggle so
 * the results table gets the vertical space — the header stays a single line
 * (an optional `summary` gives an at-a-glance readout while collapsed).
 *
 * While a crawl/verify is live the rail is forced open on mobile too, so the
 * progress bar in `children` stays visible; the toggle hides for that window.
 */
export function StatsBar({
  summary,
  live,
  verifying,
  children,
}: {
  summary?: React.ReactNode;
  live?: boolean;
  /** Email verification in progress — keep the mobile bar collapsed and let the
   *  compact `summary` (a “Verifying emails…” indicator) stand in for the rail,
   *  instead of forcing the whole rail open the way a crawl does. */
  verifying?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  // A crawl forces the rail open so its progress bar shows; a verify leaves the
  // bar collapsed and shows its indicator in the toggle instead.
  const forceOpen = !!live && !verifying;
  const openOnMobile = open || forceOpen;

  return (
    <div className="border-b border-border bg-surface/40">
      {!forceOpen && (
        <div className="px-4 py-2 sm:px-6 md:hidden">
          <button
            onClick={() => setOpen((o) => !o)}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-2 py-1.5 text-xs shadow-xs transition-colors hover:bg-surface/60",
              open && "border-brand/30",
            )}
            aria-expanded={open}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md", open ? "bg-brand/10 text-brand" : "bg-surface text-muted-foreground")}>
                <BarChart3 className="size-3.5" strokeWidth={1.75} />
              </span>
              <span className="font-semibold text-foreground">Stats</span>
              {summary && !open && <span className="truncate text-muted-foreground">· {summary}</span>}
            </span>
            <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} strokeWidth={1.75} />
          </button>
        </div>
      )}
      <div
        className={cn(
          "items-center gap-2 overflow-x-auto scrollbar-thin px-4 pb-2.5 text-sm sm:px-6 [&>*]:shrink-0 md:flex md:flex-wrap md:overflow-visible md:py-2.5",
          openOnMobile ? "flex" : "hidden",
          live && "pt-2 md:pt-2.5", // no toggle button above it, so add its own top padding
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Stat chip used inside StatsBar: tinted icon tile + label + value (same look on every leads surface). */
export function StatChip({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: string; tone?: Tone }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card py-1 pl-1 pr-2.5 shadow-xs">
      <Icon className={cn("box-content size-3.5 rounded-md p-1.5", tone ? TONES[tone] : "bg-surface text-muted-foreground")} strokeWidth={1.75} />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

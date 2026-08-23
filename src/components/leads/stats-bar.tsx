"use client";
import * as React from "react";
import { ChevronDown, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

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
  children,
}: {
  summary?: string;
  live?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const openOnMobile = open || !!live;

  return (
    <div className="border-b">
      {!live && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 px-4 py-2 text-xs text-muted-foreground md:hidden"
          aria-expanded={open}
        >
          <span className="flex min-w-0 items-center gap-1.5 font-medium">
            <BarChart3 className="size-3.5 shrink-0" />
            Stats
            {summary && !open && <span className="truncate font-normal text-muted-foreground/80">· {summary}</span>}
          </span>
          <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
        </button>
      )}
      <div
        className={cn(
          "items-center gap-x-5 gap-y-2 overflow-x-auto scrollbar-thin px-4 pb-2 text-sm [&>*]:shrink-0 md:flex md:flex-wrap md:overflow-visible md:py-2.5",
          openOnMobile ? "flex" : "hidden",
          live && "pt-2 md:pt-2.5", // no toggle button above it, so add its own top padding
        )}
      >
        {children}
      </div>
    </div>
  );
}

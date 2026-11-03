"use client";
import * as React from "react";
import { Columns3, Eye, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Compact on/off switch used for column visibility rows (presentational). */
function MiniSwitch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border transition-colors duration-150",
        on ? "border-transparent bg-brand dark:bg-primary" : "border-border bg-surface",
      )}
    >
      <span
        className={cn(
          "absolute size-3.5 rounded-full bg-card shadow-xs ring-1 ring-black/5 transition-transform duration-150 dark:ring-white/10",
          on ? "translate-x-[15px]" : "translate-x-[1px]",
        )}
      />
    </span>
  );
}

/**
 * Column visibility popover shared by the lead tables. Rows are toggle
 * switches; footer offers "Show all" (turns every hidden column on via
 * onToggle) and "Reset to default".
 */
export function ColumnsMenu<K extends string>({
  defs, cols, onToggle, onReset,
}: {
  defs: readonly { key: K; label: string }[];
  cols: Record<K, boolean>;
  onToggle: (k: K) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const shown = defs.filter((c) => cols[c.key]).length;
  const hidden = defs.length - shown;
  const pct = defs.length > 0 ? (shown / defs.length) * 100 : 0;

  return (
    <div ref={ref} className="relative inline-block text-left">
      <Button size="sm" variant={open ? "brand" : "outline"} className="h-9" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <Columns3 /> <span className="hidden sm:inline">Columns</span>
        <span
          className={cn(
            "ml-0.5 rounded-md px-1.5 py-px text-[10px] font-semibold tabular-nums sm:ml-1",
            hidden > 0 ? "bg-brand/10 text-brand" : "bg-surface text-muted-foreground",
          )}
        >
          {shown}/{defs.length}
        </span>
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Visible columns"
          className="absolute right-0 z-40 mt-1.5 w-72 animate-fade-in overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-pop"
          style={{ fontFamily: "var(--font-sans), system-ui, sans-serif" }}
        >
          {/* Header */}
          <div className="border-b border-border px-3.5 pb-3 pt-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <Columns3 className="size-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight">Columns</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium tabular-nums text-foreground">{shown}</span> of <span className="tabular-nums">{defs.length}</span> visible
                </p>
              </div>
            </div>
            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>

          {/* Rows */}
          <div className="scrollbar-thin max-h-72 overflow-y-auto p-1.5">
            {defs.map((c) => {
              const on = !!cols[c.key];
              return (
                <label
                  key={c.key}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] transition-colors hover:bg-surface",
                    on ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => onToggle(c.key)} />
                  <span className={cn("flex-1 truncate", on && "font-medium")}>{c.label}</span>
                  <MiniSwitch on={on} />
                </label>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 border-t border-border bg-surface/60 px-2 py-2">
            <button
              type="button"
              disabled={hidden === 0}
              onClick={() => defs.forEach((c) => { if (!cols[c.key]) onToggle(c.key); })}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand/10 disabled:pointer-events-none disabled:opacity-40"
            >
              <Eye className="size-3.5" /> Show all
            </button>
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              <RotateCcw className="size-3.5" /> Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

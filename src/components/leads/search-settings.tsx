"use client";
import * as React from "react";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CheckboxIndicator } from "@/components/ui/checkbox";

export interface ColumnOption {
  key: string;
  label: string;
}

/** Self-contained popover (does not close on inner clicks) for column + page-size settings. */
export function SearchSettings({
  columns, visible, onToggleColumn, pageSize, onPageSize,
}: {
  columns: ColumnOption[];
  visible: Set<string>;
  onToggleColumn: (key: string) => void;
  pageSize: number;
  onPageSize: (n: number) => void;
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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-medium shadow-xs transition-colors hover:bg-surface",
          open ? "border-brand/40 text-brand" : "border-border text-foreground",
        )}
      >
        <Settings2 className="size-4" strokeWidth={1.75} /> Search settings
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-40 w-64 animate-fade-in overflow-hidden rounded-xl border border-border bg-popover shadow-pop">
          <div className="p-3">
            <p className="mb-1.5 px-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Columns</p>
            <div className="space-y-0.5">
              {columns.map((c) => {
                const checked = visible.has(c.key);
                return (
                  <label
                    key={c.key}
                    className="group relative flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-[13px] text-foreground transition-colors hover:bg-surface"
                  >
                    <CheckboxIndicator checked={checked} />
                    <input type="checkbox" className="sr-only" checked={checked} onChange={() => onToggleColumn(c.key)} />
                    {c.label}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="border-t border-border bg-surface/50 p-3">
            <p className="mb-2 px-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Rows per page</p>
            <div className="flex rounded-lg border border-border bg-surface p-0.5">
              {[25, 50, 100].map((n) => (
                <button
                  key={n}
                  onClick={() => onPageSize(n)}
                  className={cn(
                    "flex-1 rounded-md px-2.5 py-1 text-[13px] font-medium tabular-nums transition-colors",
                    pageSize === n ? "bg-card text-brand shadow-xs" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

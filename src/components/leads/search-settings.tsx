"use client";
import * as React from "react";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

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
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input bg-card px-3 text-sm font-medium hover:bg-muted"
      >
        <Settings2 className="size-4" /> Search settings
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-40 w-64 animate-fade-in rounded-xl border bg-popover p-4 shadow-xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Columns</p>
          <div className="space-y-1.5">
            {columns.map((c) => {
              const checked = visible.has(c.key);
              return (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <span className={cn("flex size-4 items-center justify-center rounded border", checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card")}>
                    {checked && (
                      <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <input type="checkbox" className="sr-only" checked={checked} onChange={() => onToggleColumn(c.key)} />
                  {c.label}
                </label>
              );
            })}
          </div>

          <div className="my-3 h-px bg-border" />
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rows per page</p>
          <div className="flex gap-1.5">
            {[25, 50, 100].map((n) => (
              <button
                key={n}
                onClick={() => onPageSize(n)}
                className={cn(
                  "flex-1 rounded-md border px-2 py-1 text-sm font-medium",
                  pageSize === n ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-muted",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

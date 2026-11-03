"use client";
import * as React from "react";
import { Check, ChevronsUpDown, Search, Loader2, CircleCheck, CircleAlert, Clock } from "lucide-react";
import { cn, formatDate, formatNumber } from "@/lib/utils";

export interface PickerJob {
  id: string;
  name: string;
  createdAt: string;
  status?: string;
  progress?: number;
  /** e.g. { n: 25, unit: "people" } */
  count?: { n: number; unit: string } | null;
}

type StatusKind = "live" | "done" | "failed" | "idle";

function statusKind(status?: string): StatusKind {
  const s = (status ?? "").toLowerCase();
  if (/collect|run|queue|crawl|process|pending|search|verif/.test(s)) return "live";
  if (/fail|error|block/.test(s)) return "failed";
  if (/done|complete|finish|ready|success/.test(s)) return "done";
  return "idle";
}

const STATUS_UI: Record<StatusKind, { label: string; tile: string; pill: string; icon: React.ElementType }> = {
  live: { label: "Live", tile: "bg-brand/10 text-brand", pill: "bg-brand/10 text-brand", icon: Loader2 },
  done: { label: "Done", tile: "bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]", pill: "bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]", icon: CircleCheck },
  failed: { label: "Failed", tile: "bg-[hsl(var(--invalid)/0.1)] text-[hsl(var(--invalid))]", pill: "bg-[hsl(var(--invalid)/0.1)] text-[hsl(var(--invalid))]", icon: CircleAlert },
  idle: { label: "Saved", tile: "bg-surface text-muted-foreground", pill: "bg-surface text-muted-foreground", icon: Clock },
};

/**
 * Searchable job switcher for the Find Leads tabs (replaces the plain select):
 * each run shows its status, date and size; the current one is checked.
 */
export function JobPicker({
  jobs, value, onChange, icon: TabIcon, label = "Search", footer, className,
}: {
  jobs: PickerJob[];
  value: string | null;
  onChange: (id: string) => void;
  /** The tab's icon, shown on the trigger. */
  icon: React.ElementType;
  /** Noun for the list header, e.g. "People searches". */
  label?: string;
  /** Optional action rendered at the bottom of the popover (e.g. an Import button). */
  footer?: (close: () => void) => React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [idx, setIdx] = React.useState(0);
  const ref = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const current = jobs.find((j) => j.id === value) ?? jobs[0];
  const showSearch = jobs.length > 5;
  const filtered = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? jobs.filter((j) => j.name.toLowerCase().includes(s)) : jobs;
  }, [jobs, q]);

  React.useEffect(() => {
    if (!open) return;
    setQ("");
    setIdx(Math.max(0, jobs.findIndex((j) => j.id === value)));
    const t = setTimeout(() => searchRef.current?.focus(), 10);
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown); };
  }, [open, jobs, value]);

  React.useEffect(() => setIdx(0), [q]);
  React.useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx, open]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[idx]) choose(filtered[idx].id); }
  };

  if (!current) return null;
  const curStatus = statusKind(current.status);

  return (
    <div ref={ref} className={cn("relative", className)} onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-lg border bg-card pl-1 pr-2 text-left shadow-xs transition-colors hover:border-brand/40",
          open ? "border-brand/60 ring-[3px] ring-ring/15" : "border-border",
        )}
      >
        <span className="relative flex size-7 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
          <TabIcon className="size-3.5" strokeWidth={1.9} />
          {curStatus === "live" && <span className="absolute -right-0.5 -top-0.5 size-2 animate-pulse rounded-full bg-brand ring-2 ring-card" />}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-medium">{current.name}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {formatDate(current.createdAt)}
            {current.count ? ` · ${formatNumber(current.count.n)} ${current.count.unit}` : ""}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1.5 w-[min(24rem,calc(100vw-2rem))] animate-fade-in overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-pop"
          style={{ fontFamily: "var(--font-sans), system-ui, sans-serif" }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <span className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">{jobs.length}</span>
          </div>

          {showSearch && (
            <div className="border-b border-border p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Find a run…"
                  type="search"
                  name="job-picker-search"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  className="h-8 w-full rounded-md border border-input bg-surface/60 pl-8 pr-2 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-brand/60 focus:bg-card focus:ring-[3px] focus:ring-ring/15 [&::-webkit-search-cancel-button]:hidden"
                />
              </div>
            </div>
          )}

          <div ref={listRef} role="listbox" className="scrollbar-thin max-h-80 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">No runs match “{q}”</p>
            ) : (
              filtered.map((j, i) => {
                const st = STATUS_UI[statusKind(j.status)];
                const selected = j.id === current.id;
                const active = i === idx;
                const StIcon = st.icon;
                return (
                  <button
                    key={j.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-idx={i}
                    onMouseMove={() => setIdx(i)}
                    onClick={() => choose(j.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                      active ? "bg-surface" : "",
                      selected && "bg-brand/[0.06]",
                    )}
                  >
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", st.tile)}>
                      <StIcon className={cn("size-3.5", statusKind(j.status) === "live" && "animate-spin")} strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-[13px]", selected ? "font-semibold text-foreground" : "font-medium")}>{j.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {formatDate(j.createdAt)}
                        {j.count ? <> · <span className="tabular-nums">{formatNumber(j.count.n)}</span> {j.count.unit}</> : null}
                        {statusKind(j.status) === "live" && typeof j.progress === "number" ? ` · ${j.progress}%` : ""}
                      </span>
                    </span>
                    <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold", st.pill)}>{st.label}</span>
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {selected && <Check className="size-4 text-brand" strokeWidth={2.25} />}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {footer && <div className="border-t border-border bg-surface/60 p-1.5">{footer(() => setOpen(false))}</div>}
        </div>
      )}
    </div>
  );
}

"use client";
import * as React from "react";
import { ChevronDown, X, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------ FilterSection ---------------------------- */

export function FilterSection({
  title, defaultOpen = false, count, onClear, children,
}: {
  title: string;
  defaultOpen?: boolean;
  count?: number;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const active = (count ?? 0) > 0;
  return (
    <div className="border-b border-border/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        <span className={cn("size-1.5 shrink-0 rounded-full transition-colors", active ? "bg-primary" : "bg-transparent")} />
        <span className="flex flex-1 items-center gap-1.5 text-[13px] font-semibold">
          {title}
          {active && <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary tabular-nums">{count}</span>}
        </span>
        {active && onClear && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onClear(); } }}
            className="rounded px-1 text-[11px] font-medium text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
          >
            Clear
          </span>
        )}
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      <div className={cn("grid transition-all duration-200", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden">
          <div className="px-4 pb-3.5 pt-0.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- TokenList ------------------------------ */

export function TokenList({
  values, onChange, placeholder, tone = "include", label,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  tone?: "include" | "exclude";
  label?: string;
}) {
  const [input, setInput] = React.useState("");
  const add = () => {
    const v = input.trim();
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setInput("");
  };
  const remove = (v: string) => onChange(values.filter((x) => x !== v));

  return (
    <div className="space-y-2">
      {label && <p className="text-xs text-muted-foreground">{label}</p>}
      <div className="flex items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 py-2 transition-colors focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15">
        <Plus className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          onBlur={add}
          placeholder={placeholder}
          className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className={cn(
                "inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-[11px] font-medium",
                tone === "exclude" ? "bg-invalid/10 text-[hsl(var(--invalid))]" : "bg-primary/10 text-primary",
              )}
            >
              {v}
              <button onClick={() => remove(v)} aria-label={`Remove ${v}`} className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ CheckboxList ----------------------------- */

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card group-hover:border-primary/50",
      )}
    >
      {checked && (
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

export function CheckboxList({
  options, selected, onToggle, searchable, searchAt = 8, collapseAt = 8,
}: {
  options: Option[];
  selected: string[];
  onToggle: (value: string) => void;
  /** Force the search box on/off. Defaults to on when options exceed `searchAt`. */
  searchable?: boolean;
  searchAt?: number;
  /** Collapse to this many rows with a "Show all" toggle. */
  collapseAt?: number;
}) {
  const [q, setQ] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);
  const showSearch = searchable ?? options.length > searchAt;

  const query = q.trim().toLowerCase();
  const filtered = query ? options.filter((o) => o.label.toLowerCase().includes(query)) : options;
  const collapsible = !query && filtered.length > collapseAt;
  const visible = collapsible && !expanded ? filtered.slice(0, collapseAt) : filtered;

  if (options.length === 0) return <p className="px-1 py-1.5 text-xs text-muted-foreground">No options</p>;

  return (
    <div className="space-y-1.5">
      {showSearch && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="w-full rounded-lg border border-input bg-card py-1.5 pl-8 pr-7 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
          />
          {q && (
            <button onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="-mx-2 space-y-0.5">
        {visible.map((o) => {
          const checked = selected.includes(o.value);
          return (
            <label
              key={o.value}
              className={cn(
                "group flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-muted/60",
                checked && "bg-primary/[0.06]",
              )}
            >
              <CheckMark checked={checked} />
              <input type="checkbox" className="sr-only" checked={checked} onChange={() => onToggle(o.value)} />
              <span className={cn("flex-1 truncate", checked && "font-medium")}>{o.label}</span>
              {o.hint && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground transition-colors group-hover:bg-card">
                  {o.hint}
                </span>
              )}
            </label>
          );
        })}
        {visible.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No matches</p>}
      </div>

      {collapsible && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="px-2 text-[11px] font-medium text-primary hover:underline"
        >
          {expanded ? "Show less" : `Show all ${filtered.length}`}
        </button>
      )}
    </div>
  );
}

/* ---------------------------- ChipToggleGroup ---------------------------- */

export function ChipToggleGroup({
  options, selected, onToggle,
}: {
  options: Option[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = selected.includes(o.value);
        return (
          <button
            key={o.value}
            onClick={() => onToggle(o.value)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              active ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------- RangeMin -------------------------------- */

export function RangeMin({
  value, onChange, label,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn(
          "rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
          value > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}>
          {value > 0 ? `${value}+` : "Any"}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[hsl(var(--primary))] [&::-webkit-slider-thumb]:bg-card [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[hsl(var(--primary))] [&::-moz-range-thumb]:bg-card"
        style={{ background: `linear-gradient(to right, hsl(var(--primary)) ${pct}%, hsl(var(--muted)) ${pct}%)` }}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>0</span><span>50</span><span>100</span>
      </div>
    </div>
  );
}

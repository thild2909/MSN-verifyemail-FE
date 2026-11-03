"use client";
import * as React from "react";
import {
  ChevronDown, X, Plus, Search, MailCheck, Briefcase, Crown, Linkedin, Building2, MapPin, Users, Gauge, Factory,
  Database, ShieldCheck, CalendarDays, Laptop, Clock, DollarSign, Cpu, Sparkles, ListChecks, SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CheckboxIndicator as CheckMark } from "@/components/ui/checkbox";

/* ------------------------------ FilterSection ---------------------------- */

/**
 * Icon per filter group, matched on the (lower-cased) title so every sidebar
 * gets consistent iconography without changing its call sites.
 */
const SECTION_ICONS: [RegExp, React.ElementType][] = [
  [/email|mail/, MailCheck],
  [/job title|title|role/, Briefcase],
  [/seniority|level/, Crown],
  [/linkedin/, Linkedin],
  [/company|compan|organization/, Building2],
  [/location|country|city|region|geo/, MapPin],
  [/employee|headcount|size/, Users],
  [/score|confidence|match/, Gauge],
  [/industr|sector/, Factory],
  [/source/, Database],
  [/status|verif/, ShieldCheck],
  [/date|posted|time|recency/, CalendarDays],
  [/work mode|remote|mode/, Laptop],
  [/type|employment/, Clock],
  [/salary|revenue|fund/, DollarSign],
  [/tech|stack/, Cpu],
  [/qualif|signal|intent/, Sparkles],
  [/list/, ListChecks],
];

function sectionIcon(title: string): React.ElementType {
  const t = title.toLowerCase();
  return SECTION_ICONS.find(([re]) => re.test(t))?.[1] ?? SlidersHorizontal;
}

export function FilterSection({
  title, defaultOpen = false, count, onClear, children, icon,
}: {
  title: string;
  defaultOpen?: boolean;
  count?: number;
  onClear?: () => void;
  children: React.ReactNode;
  /** Optional explicit icon; otherwise picked from the title. */
  icon?: React.ElementType;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const active = (count ?? 0) > 0;
  const Icon = icon ?? sectionIcon(title);
  return (
    <div className="px-2 py-0.5">
      <div className={cn("rounded-xl transition-colors", open && "bg-surface/50")}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="group flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20"
          aria-expanded={open}
        >
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
              active ? "bg-brand/10 text-brand" : "bg-card text-muted-foreground shadow-xs ring-1 ring-inset ring-border group-hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
          </span>
          <span className={cn("flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-semibold", active ? "text-foreground" : "text-foreground/85")}>
            <span className="truncate">{title}</span>
            {active && (
              <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold tabular-nums text-white dark:bg-primary">
                {count}
              </span>
            )}
          </span>
          {active && onClear && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onClear(); } }}
              className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-brand transition-colors hover:bg-brand/10"
            >
              Clear
            </span>
          )}
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors group-hover:text-foreground">
            <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} strokeWidth={1.75} />
          </span>
        </button>
        <div className={cn("grid transition-all duration-200", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
          <div className="overflow-hidden">
            <div className="px-2.5 pb-3 pt-1">{children}</div>
          </div>
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
      {label && <p className="text-[11px] font-medium text-muted-foreground">{label}</p>}
      <div className="flex items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 py-2 shadow-xs transition-colors hover:border-brand/30 focus-within:border-brand/60 focus-within:ring-[3px] focus-within:ring-brand/15">
        <Plus className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
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
                "inline-flex max-w-full items-center gap-1 rounded-md py-0.5 pl-1.5 pr-0.5 text-[11px] font-semibold ring-1 ring-inset",
                tone === "exclude" ? "bg-[hsl(var(--invalid)/0.1)] text-[hsl(var(--invalid))] ring-[hsl(var(--invalid)/0.2)]" : "bg-brand/10 text-brand ring-brand/20",
              )}
            >
              <span className="truncate">{v}</span>
              <button onClick={() => remove(v)} aria-label={`Remove ${v}`} className="rounded p-0.5 opacity-70 transition-colors hover:bg-foreground/10 hover:opacity-100">
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
            type="search"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            className="w-full rounded-lg border border-input bg-surface/60 py-1.5 pl-8 pr-7 text-xs outline-none transition-colors placeholder:text-muted-foreground hover:border-brand/30 focus:border-brand/60 focus:bg-card focus:ring-[3px] focus:ring-brand/15 [&::-webkit-search-cancel-button]:hidden"
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
                "group relative flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-surface",
                checked && "bg-brand/[0.06] hover:bg-brand/[0.09]",
              )}
            >
              <CheckMark checked={checked} />
              <input type="checkbox" className="sr-only" checked={checked} onChange={() => onToggle(o.value)} />
              <span className={cn("flex-1 truncate", checked ? "font-medium text-foreground" : "text-foreground/90")}>{o.label}</span>
              {o.hint && (
                <span className={cn("shrink-0 rounded-md px-1.5 py-px text-[10px] font-semibold leading-4 tabular-nums transition-colors", checked ? "bg-brand/10 text-brand" : "bg-surface text-muted-foreground group-hover:bg-card")}>
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
          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold text-brand transition-colors hover:bg-brand/10"
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
              "rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors",
              active ? "border-brand/50 bg-brand/10 text-brand shadow-xs" : "border-border bg-card text-muted-foreground hover:border-brand/40 hover:bg-surface/60 hover:text-foreground",
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
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className={cn(
          "rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
          value > 0 ? "bg-brand/10 text-brand" : "bg-surface text-muted-foreground",
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
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[hsl(var(--brand))] [&::-webkit-slider-thumb]:bg-card [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[hsl(var(--brand))] [&::-moz-range-thumb]:bg-card"
        style={{ background: `linear-gradient(to right, hsl(var(--brand)) ${pct}%, hsl(var(--border)) ${pct}%)` }}
      />
      <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground/80">
        <span>0</span><span>50</span><span>100</span>
      </div>
    </div>
  );
}

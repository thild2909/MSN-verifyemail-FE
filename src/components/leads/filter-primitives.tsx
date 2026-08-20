"use client";
import * as React from "react";
import { ChevronDown, X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------ FilterSection ---------------------------- */

export function FilterSection({
  title, defaultOpen = false, count, children,
}: {
  title: string;
  defaultOpen?: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border-b border-border/70">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          {title}
          {count ? <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">{count}</span> : null}
        </span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="px-4 pb-4 pt-0.5">{children}</div>}
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
      <div className="flex items-center gap-1.5 rounded-lg border border-input bg-card px-2 py-1.5">
        <Plus className="size-3.5 text-muted-foreground" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
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
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                tone === "exclude" ? "bg-invalid/10 text-[hsl(var(--invalid))]" : "bg-primary/10 text-primary",
              )}
            >
              {v}
              <button onClick={() => remove(v)} aria-label={`Remove ${v}`} className="hover:opacity-70">
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
  options, selected, onToggle,
}: {
  options: Option[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      {options.map((o) => {
        const checked = selected.includes(o.value);
        return (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 text-[13px]">
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded border transition-colors",
                checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card",
              )}
            >
              {checked && (
                <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <input type="checkbox" className="sr-only" checked={checked} onChange={() => onToggle(o.value)} />
            <span className="flex-1">{o.label}</span>
            {o.hint && <span className="text-xs tabular-nums text-muted-foreground">{o.hint}</span>}
          </label>
        );
      })}
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
              active ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-muted-foreground hover:text-foreground",
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
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{value}+</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[hsl(var(--primary))]"
      />
    </div>
  );
}

"use client";
import * as React from "react";
import { Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseNaturalQuery } from "@/lib/leads/nl-search";
import type { PeopleFilters } from "@/lib/leads/types";

export function SearchBar({
  value, onChange, onApplyParsed, placeholder, inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onApplyParsed?: (patch: Partial<PeopleFilters>) => void;
  placeholder: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const parsed = React.useMemo(() => (onApplyParsed ? parseNaturalQuery(value) : { chips: [], patch: {} }), [value, onApplyParsed]);
  const [dismissed, setDismissed] = React.useState(false);
  React.useEffect(() => setDismissed(false), [value]);

  const showPanel = onApplyParsed && parsed.chips.length > 0 && !dismissed;

  return (
    <div className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {showPanel && (
        <div className="absolute left-0 right-0 top-12 z-30 animate-fade-in rounded-xl border bg-popover p-4 shadow-xl">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-primary">
            <Sparkles className="size-3.5" /> AI understood your search as:
          </p>
          <div className="flex flex-wrap gap-3">
            {parsed.chips.map((c, i) => (
              <div key={i} className="rounded-lg border bg-card px-3 py-1.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{c.field}</p>
                <p className="text-sm font-medium">{c.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>Dismiss</Button>
            <Button size="sm" onClick={() => { onApplyParsed?.(parsed.patch); setDismissed(true); }}>
              <Sparkles className="size-4" /> Apply filters
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

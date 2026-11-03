"use client";
import * as React from "react";
import { Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/common/kit";
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
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
      <input
        ref={inputRef}
        type="search"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm shadow-xs transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-brand/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/15"
      />

      {showPanel && (
        <div className="absolute left-0 right-0 top-12 z-30 animate-fade-in overflow-hidden rounded-xl border border-border bg-popover shadow-pop">
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <IconTile icon={Sparkles} tone="violet" size="sm" />
            <p className="text-[13px] font-semibold">AI understood your search as:</p>
          </div>
          <div className="flex flex-wrap gap-2 p-4">
            {parsed.chips.map((c, i) => (
              <div key={i} className="rounded-lg border border-border bg-surface px-3 py-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{c.field}</p>
                <p className="text-[13px] font-medium text-foreground">{c.label}</p>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t border-border bg-surface/50 px-4 py-2.5">
            <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>Dismiss</Button>
            <Button size="sm" onClick={() => { onApplyParsed?.(parsed.patch); setDismissed(true); }}>
              <Sparkles /> Apply filters
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

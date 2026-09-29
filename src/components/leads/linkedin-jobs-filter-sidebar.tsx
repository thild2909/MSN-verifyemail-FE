"use client";
import * as React from "react";
import { Select } from "@/components/ui/select";
import { CheckboxIndicator } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { FilterSection, CheckboxList, RangeMin, type Option } from "./filter-primitives";
import type { LinkedInJobFilters } from "@/lib/leads/linkedin-jobs-types";
import type { CollectedLinkedInJobsPage } from "@/lib/api/client";

const toggle = (arr: string[], v: string): string[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

const POSTED_OPTIONS = [
  { v: 0, l: "Any time" }, { v: 1, l: "Last 24 hours" }, { v: 7, l: "Last 7 days" }, { v: 14, l: "Last 14 days" }, { v: 30, l: "Last 30 days" },
];

function facetOptions(facet: Record<string, number>): Option[] {
  return Object.entries(facet).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, label: value, hint: String(count) }));
}

/** Size bands in size order ("2-10" < "11-50" < … < "10,001+"), not by count. */
function employeeOptions(facet: Record<string, number>): Option[] {
  const min = (band: string) => Number((band.match(/[\d,]+/)?.[0] ?? "").replace(/,/g, "")) || Number.MAX_SAFE_INTEGER;
  return Object.entries(facet).sort((a, b) => min(a[0]) - min(b[0]))
    .map(([value, count]) => ({ value, label: value.replace(/\s*employees?$/i, ""), hint: String(count) }));
}

export function LinkedInJobsFilterSidebar({
  filters, onChange, activeCount, onClear, facets,
}: {
  filters: LinkedInJobFilters;
  onChange: (patch: Partial<LinkedInJobFilters>) => void;
  activeCount: number;
  onClear: () => void;
  facets?: CollectedLinkedInJobsPage["facets"];
}) {
  const roleOpts = facetOptions(facets?.roleFamilies ?? {});
  const countryOpts = facetOptions(facets?.countries ?? {});
  const seniorityOpts = facetOptions(facets?.seniorities ?? {});
  const industryOpts = facetOptions(facets?.industries ?? {});
  const employeeOpts = employeeOptions(facets?.employeeRanges ?? {});
  const [industryMode, setIndustryMode] = React.useState<"include" | "exclude">("include");
  const industryKey = industryMode === "include" ? "industries" : "excludedIndustries";
  const otherKey = industryMode === "include" ? "excludedIndustries" : "industries";
  const industryCount = filters.industries.length + filters.excludedIndustries.length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          Filters
          {activeCount > 0 && <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">{activeCount}</span>}
        </span>
        {activeCount > 0 && <button onClick={onClear} className="text-xs font-medium text-primary hover:underline">Clear all</button>}
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <FilterSection title="Qualification" defaultOpen>
          <div className="space-y-3">
            <label className="group relative flex cursor-pointer items-center gap-2 text-[13px]">
              <CheckboxIndicator checked={filters.qualifiedOnly} />
              <input type="checkbox" className="sr-only" checked={filters.qualifiedOnly} onChange={(e) => onChange({ qualifiedOnly: e.target.checked })} />
              Qualified only
            </label>
            <label className="group relative flex cursor-pointer items-center gap-2 text-[13px]">
              <CheckboxIndicator checked={filters.remoteOnly} />
              <input type="checkbox" className="sr-only" checked={filters.remoteOnly} onChange={(e) => onChange({ remoteOnly: e.target.checked })} />
              Remote only
            </label>
            <RangeMin value={filters.minScore} onChange={(n) => onChange({ minScore: n })} label="Min fit score" />
          </div>
        </FilterSection>

        <FilterSection title="Role family" defaultOpen count={filters.roleFamilies.length || undefined}>
          <CheckboxList options={roleOpts} selected={filters.roleFamilies} onToggle={(v) => onChange({ roleFamilies: toggle(filters.roleFamilies, v) })} />
        </FilterSection>

        <FilterSection title="Country" count={filters.countries.length || undefined}>
          <CheckboxList options={countryOpts} selected={filters.countries} onToggle={(v) => onChange({ countries: toggle(filters.countries, v) })} />
        </FilterSection>

        <FilterSection title="Industry" count={industryCount || undefined}>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5">
              {(["include", "exclude"] as const).map((m) => {
                const n = m === "include" ? filters.industries.length : filters.excludedIndustries.length;
                return (
                  <button key={m} type="button" onClick={() => setIndustryMode(m)}
                    className={cn("rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors",
                      industryMode === m ? (m === "exclude" ? "bg-card text-[hsl(var(--invalid))] shadow-sm" : "bg-card text-primary shadow-sm") : "text-muted-foreground hover:text-foreground")}>
                    {m}{n > 0 ? ` (${n})` : ""}
                  </button>
                );
              })}
            </div>
            {industryOpts.length === 0
              ? <p className="px-1 py-1.5 text-xs text-muted-foreground">Run &ldquo;Qualify companies&rdquo; to load industries.</p>
              : <CheckboxList
                  key={industryMode}
                  options={industryOpts}
                  selected={filters[industryKey]}
                  // An industry lives in one list only: picking it here removes it from the other.
                  onToggle={(v) => onChange({ [industryKey]: toggle(filters[industryKey], v), [otherKey]: filters[otherKey].filter((x) => x !== v) })}
                />}
          </div>
        </FilterSection>

        <FilterSection title="Employees" count={filters.employeeRanges.length || undefined}>
          {employeeOpts.length === 0
            ? <p className="px-1 py-1.5 text-xs text-muted-foreground">Run &ldquo;Qualify companies&rdquo; to load company sizes.</p>
            : <CheckboxList options={employeeOpts} selected={filters.employeeRanges} onToggle={(v) => onChange({ employeeRanges: toggle(filters.employeeRanges, v) })} searchable={false} collapseAt={10} />}
        </FilterSection>

        <FilterSection title="Seniority" count={filters.seniorities.length || undefined}>
          <CheckboxList options={seniorityOpts} selected={filters.seniorities} onToggle={(v) => onChange({ seniorities: toggle(filters.seniorities, v) })} />
        </FilterSection>

        <FilterSection title="Posted date" count={filters.postedWithinDays > 0 ? 1 : undefined}>
          <Select value={String(filters.postedWithinDays)} onChange={(e) => onChange({ postedWithinDays: Number(e.target.value) })}>
            {POSTED_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
        </FilterSection>
      </div>
    </div>
  );
}

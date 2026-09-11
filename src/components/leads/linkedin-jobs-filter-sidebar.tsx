"use client";
import { Select } from "@/components/ui/select";
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
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input type="checkbox" checked={filters.qualifiedOnly} onChange={(e) => onChange({ qualifiedOnly: e.target.checked })} className="size-4 accent-[hsl(var(--primary))]" />
              Qualified only
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input type="checkbox" checked={filters.remoteOnly} onChange={(e) => onChange({ remoteOnly: e.target.checked })} className="size-4 accent-[hsl(var(--primary))]" />
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

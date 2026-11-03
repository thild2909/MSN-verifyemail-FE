"use client";
import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { IconTile } from "@/components/common/kit";
import {
  FilterSection, TokenList, CheckboxList, ChipToggleGroup, type Option,
} from "./filter-primitives";
import { PEOPLE_SENIORITY_LABEL, DEPARTMENT_LABEL } from "./leads-ui";
import {
  COUNTRIES, DEPARTMENTS, EMAIL_STATUSES, EMPLOYEE_BANDS, INDUSTRIES,
  PEOPLE_SENIORITIES, TECHNOLOGIES, type PeopleFilters,
} from "@/lib/leads/types";

const toggle = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

const opt = (values: readonly string[], labels?: Record<string, string>): Option[] =>
  values.map((v) => ({ value: v, label: labels?.[v] ?? v }));

export function PeopleFilterSidebar({
  filters, onChange, activeCount, onClear,
}: {
  filters: PeopleFilters;
  onChange: (patch: Partial<PeopleFilters>) => void;
  activeCount: number;
  onClear: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-4">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <IconTile icon={SlidersHorizontal} tone={activeCount > 0 ? "brand" : "muted"} size="sm" />
          Filters
          {activeCount > 0 && <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-brand">{activeCount}</span>}
        </span>
        {activeCount > 0 && (
          <button onClick={onClear} className="rounded-md px-1.5 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand/10">Clear all</button>
        )}
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-card">
        <FilterSection title="Lists">
          <p className="text-xs text-muted-foreground">Saved lists appear here. Save leads to build one.</p>
        </FilterSection>

        <FilterSection title="Persona">
          <p className="text-xs text-muted-foreground">Match against a saved buyer persona.</p>
        </FilterSection>

        <FilterSection title="Email Status" defaultOpen count={filters.emailStatus.length || undefined}>
          <CheckboxList
            options={opt(EMAIL_STATUSES, { verified: "Verified", unverified: "Unverified", unavailable: "Unavailable" })}
            selected={filters.emailStatus}
            onToggle={(v) => onChange({ emailStatus: toggle(filters.emailStatus, v as PeopleFilters["emailStatus"][number]) })}
          />
        </FilterSection>

        <FilterSection title="Job Titles" defaultOpen count={filters.jobTitles.length || undefined}>
          <TokenList
            values={filters.jobTitles}
            onChange={(v) => onChange({ jobTitles: v })}
            placeholder="Include titles, e.g. CTO"
          />
        </FilterSection>

        <FilterSection title="People Lookalikes">
          <p className="text-xs text-muted-foreground">Find people similar to a selected lead.</p>
        </FilterSection>

        <FilterSection title="Company" count={filters.excludedCompanies.length || undefined}>
          <TokenList
            values={filters.excludedCompanies}
            onChange={(v) => onChange({ excludedCompanies: v })}
            placeholder="Exclude companies…"
            tone="exclude"
            label="Excluded companies"
          />
        </FilterSection>

        <FilterSection title="Company Lookalikes">
          <p className="text-xs text-muted-foreground">Target accounts similar to a chosen company.</p>
        </FilterSection>

        <FilterSection title="Seniority" count={filters.seniority.length || undefined}>
          <ChipToggleGroup
            options={opt(PEOPLE_SENIORITIES, PEOPLE_SENIORITY_LABEL)}
            selected={filters.seniority}
            onToggle={(v) => onChange({ seniority: toggle(filters.seniority, v as PeopleFilters["seniority"][number]) })}
          />
        </FilterSection>

        <FilterSection title="Department" count={filters.departments.length || undefined}>
          <ChipToggleGroup
            options={opt(DEPARTMENTS, DEPARTMENT_LABEL)}
            selected={filters.departments}
            onToggle={(v) => onChange({ departments: toggle(filters.departments, v as PeopleFilters["departments"][number]) })}
          />
        </FilterSection>

        <FilterSection title="Location / Country" count={filters.country !== "all" ? 1 : undefined}>
          <ChipToggleGroup
            options={opt(COUNTRIES)}
            selected={filters.country === "all" ? [] : [filters.country]}
            onToggle={(v) => onChange({ country: filters.country === v ? "all" : v })}
          />
        </FilterSection>

        <FilterSection title="Company Size" count={filters.companySize.length || undefined}>
          <ChipToggleGroup
            options={opt(EMPLOYEE_BANDS)}
            selected={filters.companySize}
            onToggle={(v) => onChange({ companySize: toggle(filters.companySize, v as PeopleFilters["companySize"][number]) })}
          />
        </FilterSection>

        <FilterSection title="Industry" count={filters.industries.length || undefined}>
          <ChipToggleGroup
            options={opt(INDUSTRIES)}
            selected={filters.industries}
            onToggle={(v) => onChange({ industries: toggle(filters.industries, v as PeopleFilters["industries"][number]) })}
          />
        </FilterSection>

        <FilterSection title="Technology Used" count={filters.technologies.length || undefined}>
          <ChipToggleGroup
            options={opt(TECHNOLOGIES)}
            selected={filters.technologies}
            onToggle={(v) => onChange({ technologies: toggle(filters.technologies, v) })}
          />
        </FilterSection>

        <FilterSection title="Availability">
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-[13px] transition-colors hover:bg-surface/60">
              Email available
              <Switch checked={filters.emailAvailable} onCheckedChange={(v) => onChange({ emailAvailable: v })} />
            </label>
            <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-[13px] transition-colors hover:bg-surface/60">
              LinkedIn available
              <Switch checked={filters.linkedinAvailable} onCheckedChange={(v) => onChange({ linkedinAvailable: v })} />
            </label>
          </div>
        </FilterSection>
      </div>
    </div>
  );
}

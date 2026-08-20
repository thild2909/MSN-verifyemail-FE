"use client";
import * as React from "react";
import { Switch } from "@/components/ui/switch";
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
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          Filters
          {activeCount > 0 && <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">{activeCount}</span>}
        </span>
        {activeCount > 0 && (
          <button onClick={onClear} className="text-xs font-medium text-primary hover:underline">Clear all</button>
        )}
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
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
            placeholder="Include titles — e.g. CTO"
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
          <div className="space-y-3">
            <label className="flex items-center justify-between text-[13px]">
              Email available
              <Switch checked={filters.emailAvailable} onCheckedChange={(v) => onChange({ emailAvailable: v })} />
            </label>
            <label className="flex items-center justify-between text-[13px]">
              LinkedIn available
              <Switch checked={filters.linkedinAvailable} onCheckedChange={(v) => onChange({ linkedinAvailable: v })} />
            </label>
          </div>
        </FilterSection>
      </div>
    </div>
  );
}

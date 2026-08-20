"use client";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { FilterSection, TokenList, ChipToggleGroup, type Option } from "./filter-primitives";
import { JOB_SENIORITY_LABEL, WORK_MODE_LABEL, EMPLOYMENT_LABEL } from "./leads-ui";
import {
  COUNTRIES, EMPLOYEE_BANDS, EMPLOYMENT_TYPES, JOB_SENIORITIES, TECHNOLOGIES, WORK_MODES,
  type JobFilters,
} from "@/lib/leads/types";

const toggle = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
const opt = (values: readonly string[], labels?: Record<string, string>): Option[] => values.map((v) => ({ value: v, label: labels?.[v] ?? v }));

const HIRING_LABEL: Record<string, string> = { strong: "Strong", medium: "Medium", weak: "Low" };
const POSTED_OPTIONS = [{ v: 0, l: "Any time" }, { v: 1, l: "Last 24 hours" }, { v: 3, l: "Last 3 days" }, { v: 7, l: "Last 7 days" }, { v: 14, l: "Last 14 days" }, { v: 30, l: "Last 30 days" }];
const SALARY_OPTIONS = [{ v: 0, l: "Any" }, { v: 100000, l: "$100k+" }, { v: 150000, l: "$150k+" }, { v: 200000, l: "$200k+" }];

export function JobFilterSidebar({
  filters, onChange, activeCount, onClear,
}: {
  filters: JobFilters;
  onChange: (patch: Partial<JobFilters>) => void;
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
        {activeCount > 0 && <button onClick={onClear} className="text-xs font-medium text-primary hover:underline">Clear all</button>}
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <FilterSection title="Job Title" defaultOpen count={filters.titles.length || undefined}>
          <TokenList values={filters.titles} onChange={(v) => onChange({ titles: v })} placeholder="e.g. AI Engineer" />
        </FilterSection>

        <FilterSection title="Location / Country" count={filters.country !== "all" ? 1 : undefined}>
          <ChipToggleGroup options={opt(COUNTRIES)} selected={filters.country === "all" ? [] : [filters.country]} onToggle={(v) => onChange({ country: filters.country === v ? "all" : v })} />
        </FilterSection>

        <FilterSection title="Work Mode" count={filters.workModes.length || undefined}>
          <ChipToggleGroup options={opt(WORK_MODES, WORK_MODE_LABEL)} selected={filters.workModes} onToggle={(v) => onChange({ workModes: toggle(filters.workModes, v as JobFilters["workModes"][number]) })} />
        </FilterSection>

        <FilterSection title="Employment Type" count={filters.employmentTypes.length || undefined}>
          <ChipToggleGroup options={opt(EMPLOYMENT_TYPES, EMPLOYMENT_LABEL)} selected={filters.employmentTypes} onToggle={(v) => onChange({ employmentTypes: toggle(filters.employmentTypes, v as JobFilters["employmentTypes"][number]) })} />
        </FilterSection>

        <FilterSection title="Seniority" count={filters.seniority.length || undefined}>
          <ChipToggleGroup options={opt(JOB_SENIORITIES, JOB_SENIORITY_LABEL)} selected={filters.seniority} onToggle={(v) => onChange({ seniority: toggle(filters.seniority, v as JobFilters["seniority"][number]) })} />
        </FilterSection>

        <FilterSection title="Posted Date" count={filters.postedWithinDays > 0 ? 1 : undefined}>
          <Select value={String(filters.postedWithinDays)} onChange={(e) => onChange({ postedWithinDays: Number(e.target.value) })}>
            {POSTED_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
        </FilterSection>

        <FilterSection title="Salary" count={filters.salaryMin > 0 ? 1 : undefined}>
          <div className="space-y-1.5">
            <Label className="text-xs">Minimum base (annual)</Label>
            <Select value={String(filters.salaryMin)} onChange={(e) => onChange({ salaryMin: Number(e.target.value) })}>
              {SALARY_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </Select>
          </div>
        </FilterSection>

        <FilterSection title="Technologies" count={filters.technologies.length || undefined}>
          <ChipToggleGroup options={opt(TECHNOLOGIES)} selected={filters.technologies} onToggle={(v) => onChange({ technologies: toggle(filters.technologies, v) })} />
        </FilterSection>

        <FilterSection title="Company Size" count={filters.companySizes.length || undefined}>
          <ChipToggleGroup options={opt(EMPLOYEE_BANDS)} selected={filters.companySizes} onToggle={(v) => onChange({ companySizes: toggle(filters.companySizes, v as JobFilters["companySizes"][number]) })} />
        </FilterSection>

        <FilterSection title="Hiring Signal" count={filters.hiringSignals.length || undefined}>
          <ChipToggleGroup options={opt(["strong", "medium", "weak"], HIRING_LABEL)} selected={filters.hiringSignals} onToggle={(v) => onChange({ hiringSignals: toggle(filters.hiringSignals, v as JobFilters["hiringSignals"][number]) })} />
        </FilterSection>
      </div>
    </div>
  );
}

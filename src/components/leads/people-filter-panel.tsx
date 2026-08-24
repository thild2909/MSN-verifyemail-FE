"use client";
import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { FilterSection, CheckboxList, TokenList, RangeMin, type Option } from "./filter-primitives";
import { EMPLOYEE_BUCKETS } from "@/lib/leads/collect-types";
import { SENIORITY_LABEL, countPeopleFilters, type PeopleFilters, type PeopleFacets } from "@/lib/leads/people-types";

const SENIORITY_ORDER = ["founder", "c_level", "president", "vp", "other"] as const;

const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export function PeopleFilterPanel({ filters, facets, onChange, onClear }: {
  filters: PeopleFilters;
  facets: PeopleFacets | undefined;
  onChange: (next: PeopleFilters) => void;
  onClear: () => void;
}) {
  const active = countPeopleFilters(filters);

  // Email Status by the REAL verification status (mutually exclusive), so a
  // count never mislabels a row. Hide a status with 0 rows unless it's selected.
  const e = facets?.email;
  const emailOpts: Option[] = [
    { value: "has", label: "Has email", hint: String(e?.has ?? 0) },
    { value: "valid", label: "Valid", hint: String(e?.valid ?? 0) },
    { value: "catch_all", label: "Catch-all", hint: String(e?.catch_all ?? 0) },
    { value: "risky", label: "Risky / unknown", hint: String(e?.risky ?? 0) },
    { value: "invalid", label: "Invalid", hint: String(e?.invalid ?? 0) },
    { value: "unverified", label: "Unverified", hint: String(e?.unverified ?? 0) },
    { value: "none", label: "No email", hint: String(e?.none ?? 0) },
  ].filter((o) => o.value === "has" || o.hint !== "0" || filters.email.includes(o.value));

  const seniorityOpts: Option[] = SENIORITY_ORDER
    .filter((s) => (facets?.seniority[s] ?? 0) > 0 || filters.seniority.includes(s))
    .map((s) => ({ value: s, label: SENIORITY_LABEL[s], hint: String(facets?.seniority[s] ?? 0) }));

  const linkedinOpts: Option[] = [{ value: "has", label: "Has LinkedIn", hint: String(facets?.linkedin.has ?? 0) }];

  const companyOpts: Option[] = (facets?.companies ?? []).map((c) => ({ value: c.name, label: c.name, hint: String(c.count) }));

  const employeeOpts: Option[] = EMPLOYEE_BUCKETS.map((b) => ({
    value: b.value, label: b.label, hint: String(facets?.employees?.[b.value] ?? 0),
  })).filter((o) => o.hint !== "0" || filters.employees.includes(o.value));

  const industryOpts: Option[] = (facets?.industries ?? []).map((i) => ({ value: i.name, label: i.name, hint: String(i.count) }));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="size-4" /> Filters{active > 0 && <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">{active}</span>}</span>
        {active > 0 && <button onClick={onClear} className="text-xs font-medium text-primary hover:underline">Clear</button>}
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        <FilterSection title="Email Status" defaultOpen count={filters.email.length} onClear={() => onChange({ ...filters, email: [] })}>
          <CheckboxList options={emailOpts} selected={filters.email} onToggle={(v) => onChange({ ...filters, email: toggle(filters.email, v) })} />
        </FilterSection>
        <FilterSection title="Job Titles" count={filters.titles.length} onClear={() => onChange({ ...filters, titles: [] })}>
          <TokenList values={filters.titles} onChange={(v) => onChange({ ...filters, titles: v })} placeholder="Title contains…" />
        </FilterSection>
        <FilterSection title="Seniority" defaultOpen count={filters.seniority.length} onClear={() => onChange({ ...filters, seniority: [] })}>
          <CheckboxList options={seniorityOpts} selected={filters.seniority} onToggle={(v) => onChange({ ...filters, seniority: toggle(filters.seniority, v) })} />
        </FilterSection>
        <FilterSection title="LinkedIn" count={filters.linkedin ? 1 : 0} onClear={() => onChange({ ...filters, linkedin: false })}>
          <CheckboxList options={linkedinOpts} selected={filters.linkedin ? ["has"] : []} onToggle={() => onChange({ ...filters, linkedin: !filters.linkedin })} />
        </FilterSection>
        {companyOpts.length > 1 && (
          <FilterSection title="Company" count={filters.companies.length} onClear={() => onChange({ ...filters, companies: [] })}>
            <CheckboxList options={companyOpts} selected={filters.companies} onToggle={(v) => onChange({ ...filters, companies: toggle(filters.companies, v) })} />
          </FilterSection>
        )}
        <FilterSection title="Location" count={filters.locations.length} onClear={() => onChange({ ...filters, locations: [] })}>
          <TokenList values={filters.locations} onChange={(v) => onChange({ ...filters, locations: v })} placeholder="City, region or country…" />
        </FilterSection>
        {employeeOpts.length > 0 && (
          <FilterSection title="Employees" count={filters.employees.length} onClear={() => onChange({ ...filters, employees: [] })}>
            <CheckboxList options={employeeOpts} selected={filters.employees} onToggle={(v) => onChange({ ...filters, employees: toggle(filters.employees, v) })} />
          </FilterSection>
        )}
        {industryOpts.length > 0 && (
          <FilterSection title="Industry" count={filters.industries.length} onClear={() => onChange({ ...filters, industries: [] })}>
            <CheckboxList options={industryOpts} selected={filters.industries} onToggle={(v) => onChange({ ...filters, industries: toggle(filters.industries, v) })} />
          </FilterSection>
        )}
        <FilterSection title="Scores" count={filters.minScore > 0 ? 1 : 0} onClear={() => onChange({ ...filters, minScore: 0 })}>
          <RangeMin value={filters.minScore} label="Min match score" onChange={(n) => onChange({ ...filters, minScore: n })} />
        </FilterSection>
      </div>
    </div>
  );
}

"use client";
import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { FilterSection, CheckboxList, type Option } from "./filter-primitives";
import { SENIORITY_LABEL, type PeopleFilters, type PeopleFacets } from "@/lib/leads/people-types";

const SENIORITY_ORDER = ["founder", "c_level", "president", "vp", "other"] as const;

const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export function PeopleFilterPanel({ filters, facets, onChange, onClear }: {
  filters: PeopleFilters;
  facets: PeopleFacets | undefined;
  onChange: (next: PeopleFilters) => void;
  onClear: () => void;
}) {
  const active = filters.seniority.length + filters.email.length + filters.companies.length + (filters.linkedin ? 1 : 0);

  const seniorityOpts: Option[] = SENIORITY_ORDER
    .filter((s) => (facets?.seniority[s] ?? 0) > 0 || filters.seniority.includes(s))
    .map((s) => ({ value: s, label: SENIORITY_LABEL[s], hint: String(facets?.seniority[s] ?? 0) }));

  const emailOpts: Option[] = [
    { value: "has", label: "Has email", hint: String(facets?.email.has ?? 0) },
    { value: "valid", label: "Verified valid", hint: String(facets?.email.valid ?? 0) },
    { value: "bad", label: "Verified bad", hint: String(facets?.email.bad ?? 0) },
  ];

  const linkedinOpts: Option[] = [{ value: "has", label: "Has LinkedIn", hint: String(facets?.linkedin.has ?? 0) }];

  const companyOpts: Option[] = (facets?.companies ?? []).map((c) => ({ value: c.name, label: c.name, hint: String(c.count) }));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="size-4" /> Filters{active > 0 && <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">{active}</span>}</span>
        {active > 0 && <button onClick={onClear} className="text-xs font-medium text-primary hover:underline">Clear</button>}
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        <FilterSection title="Seniority" defaultOpen count={filters.seniority.length}>
          <CheckboxList options={seniorityOpts} selected={filters.seniority} onToggle={(v) => onChange({ ...filters, seniority: toggle(filters.seniority, v) })} />
        </FilterSection>
        <FilterSection title="Email" defaultOpen count={filters.email.length}>
          <CheckboxList options={emailOpts} selected={filters.email} onToggle={(v) => onChange({ ...filters, email: toggle(filters.email, v) })} />
        </FilterSection>
        <FilterSection title="LinkedIn" count={filters.linkedin ? 1 : 0}>
          <CheckboxList options={linkedinOpts} selected={filters.linkedin ? ["has"] : []} onToggle={() => onChange({ ...filters, linkedin: !filters.linkedin })} />
        </FilterSection>
        {companyOpts.length > 1 && (
          <FilterSection title="Company" count={filters.companies.length}>
            <CheckboxList options={companyOpts} selected={filters.companies} onToggle={(v) => onChange({ ...filters, companies: toggle(filters.companies, v) })} />
          </FilterSection>
        )}
      </div>
    </div>
  );
}

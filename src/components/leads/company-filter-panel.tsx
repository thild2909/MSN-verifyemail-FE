"use client";
import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { FilterSection, CheckboxList, type Option } from "./filter-primitives";
import type { CompanyFilters, CompaniesFacets } from "@/lib/leads/collect-types";

const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

const STATUS_LABEL: Record<string, string> = { enriched: "Enriched", not_found: "Not found", pending: "Pending", collecting: "Collecting", failed: "Failed" };

export function CompanyFilterPanel({ filters, facets, onChange, onClear }: {
  filters: CompanyFilters;
  facets: CompaniesFacets | undefined;
  onChange: (next: CompanyFilters) => void;
  onClear: () => void;
}) {
  const active = filters.status.length + filters.has.length + filters.email.length + filters.industries.length;

  const statusOpts: Option[] = Object.entries(facets?.status ?? {})
    .filter(([, n]) => n > 0)
    .map(([value, n]) => ({ value, label: STATUS_LABEL[value] ?? value, hint: String(n) }));

  const hasOpts: Option[] = [
    { value: "website", label: "Has website", hint: String(facets?.has.website ?? 0) },
    { value: "email", label: "Has email", hint: String(facets?.has.email ?? 0) },
    { value: "phone", label: "Has phone", hint: String(facets?.has.phone ?? 0) },
    { value: "linkedin", label: "Has LinkedIn", hint: String(facets?.has.linkedin ?? 0) },
  ];

  const emailOpts: Option[] = [
    { value: "valid", label: "Verified valid", hint: String(facets?.email.valid ?? 0) },
    { value: "bad", label: "Verified bad", hint: String(facets?.email.bad ?? 0) },
  ];

  const industryOpts: Option[] = (facets?.industries ?? []).map((i) => ({ value: i.name, label: i.name, hint: String(i.count) }));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="size-4" /> Filters{active > 0 && <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">{active}</span>}</span>
        {active > 0 && <button onClick={onClear} className="text-xs font-medium text-primary hover:underline">Clear</button>}
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        <FilterSection title="Status" defaultOpen count={filters.status.length}>
          <CheckboxList options={statusOpts} selected={filters.status} onToggle={(v) => onChange({ ...filters, status: toggle(filters.status, v) })} />
        </FilterSection>
        <FilterSection title="Data present" defaultOpen count={filters.has.length}>
          <CheckboxList options={hasOpts} selected={filters.has} onToggle={(v) => onChange({ ...filters, has: toggle(filters.has, v) })} />
        </FilterSection>
        <FilterSection title="Email" count={filters.email.length}>
          <CheckboxList options={emailOpts} selected={filters.email} onToggle={(v) => onChange({ ...filters, email: toggle(filters.email, v) })} />
        </FilterSection>
        {industryOpts.length > 0 && (
          <FilterSection title="Industry" count={filters.industries.length}>
            <CheckboxList options={industryOpts} selected={filters.industries} onToggle={(v) => onChange({ ...filters, industries: toggle(filters.industries, v) })} />
          </FilterSection>
        )}
      </div>
    </div>
  );
}

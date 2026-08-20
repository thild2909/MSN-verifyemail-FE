"use client";
import * as React from "react";
import {
  ChevronsUpDown, ArrowUp, ArrowDown, MoreHorizontal, Bookmark, Users, Building2, Workflow, ExternalLink,
} from "lucide-react";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { postedLabel } from "@/lib/leads/data";
import { CompanyLogo, HiringSignalChip, JOB_SENIORITY_LABEL, WORK_MODE_LABEL, EMPLOYMENT_LABEL } from "./leads-ui";
import type { Job, SortState } from "@/lib/leads/types";

export type JobAction = "save" | "find_decision_makers" | "view_company" | "add_workflow";

interface Props {
  rows: Job[];
  sort: SortState | null;
  onSort: (key: string) => void;
  selectedIds: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAllPage: () => void;
  allPageSelected: boolean;
  onOpenJob: (j: Job) => void;
  onAction: (action: JobAction, j: Job) => void;
}

const COLS: { key: string; label: string; sortable?: boolean }[] = [
  { key: "title", label: "Job", sortable: true },
  { key: "company", label: "Company", sortable: true },
  { key: "location", label: "Location", sortable: true },
  { key: "employment", label: "Employment" },
  { key: "posted", label: "Posted", sortable: true },
  { key: "size", label: "Company Size" },
  { key: "tech", label: "Technology" },
  { key: "signal", label: "Hiring Signal" },
];

function salary(j: Job): string {
  return `$${Math.round(j.salaryMin / 1000)}k–$${Math.round(j.salaryMax / 1000)}k`;
}

function Check({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onChange(); }} role="checkbox" aria-checked={checked}
      className={cn("flex size-4 items-center justify-center rounded border transition-colors", checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:border-primary/50")}>
      {checked && <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </button>
  );
}

export function JobsTable(props: Props) {
  const { rows, sort, onSort, selectedIds, onToggleRow, onToggleAllPage, allPageSelected, onOpenJob, onAction } = props;
  return (
    <div className="scrollbar-thin h-full overflow-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b">
            <th className="w-10 px-3 py-2.5 text-left"><Check checked={allPageSelected} onChange={onToggleAllPage} /></th>
            {COLS.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-3 py-2.5 text-left font-medium text-muted-foreground">
                {c.sortable ? (
                  <button onClick={() => onSort(c.key)} className="inline-flex items-center gap-1 hover:text-foreground">
                    {c.label}
                    {sort?.key === c.key ? (sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ChevronsUpDown className="size-3 opacity-40" />}
                  </button>
                ) : c.label}
              </th>
            ))}
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.map((j) => {
            const selected = selectedIds.has(j.id);
            return (
              <tr key={j.id} onClick={() => onOpenJob(j)} className={cn("group cursor-pointer border-b transition-colors hover:bg-muted/40", selected && "bg-primary/[0.04]")}>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><Check checked={selected} onChange={() => onToggleRow(j.id)} /></td>
                <td className="px-3 py-2">
                  <button onClick={(e) => { e.stopPropagation(); onOpenJob(j); }} className="text-left font-medium hover:text-primary hover:underline">{j.title}</button>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{JOB_SENIORITY_LABEL[j.seniority]}</span>
                    <span>{salary(j)}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2"><CompanyLogo text={j.companyLogoText} seed={j.companyId} /><span className="line-clamp-1">{j.company}</span></div>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span>{j.location}</span>
                  <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{WORK_MODE_LABEL[j.workMode]}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{EMPLOYMENT_LABEL[j.employmentType]}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{postedLabel(j.postedDaysAgo)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{j.companySize}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">{j.technologies.slice(0, 3).map((t) => <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{t}</span>)}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2"><HiringSignalChip signal={j.hiringSignal} /></td>
                <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu trigger={<button className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-label="Actions"><MoreHorizontal className="size-4" /></button>}>
                    <DropdownItem onClick={() => onAction("save", j)}><Bookmark /> Save job</DropdownItem>
                    <DropdownItem onClick={() => onAction("find_decision_makers", j)}><Users /> Find decision makers</DropdownItem>
                    <DropdownItem onClick={() => onAction("view_company", j)}><Building2 /> View company</DropdownItem>
                    <DropdownItem onClick={() => onAction("add_workflow", j)}><Workflow /> Add to workflow</DropdownItem>
                    <DropdownSeparator />
                    <DropdownItem onClick={() => onOpenJob(j)}><ExternalLink /> Open details</DropdownItem>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

"use client";
import { ColHead } from "@/components/common/col-head";
import * as React from "react";
import {
  ChevronsUpDown, ArrowUp, ArrowDown, MoreHorizontal, Bookmark, Users, Building2, Workflow, ExternalLink,
} from "lucide-react";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { Checkbox as Check } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { postedLabel } from "@/lib/leads/data";
import { TONES, avatarTone } from "@/components/common/kit";
import { HiringSignalChip, JOB_SENIORITY_LABEL, WORK_MODE_LABEL, EMPLOYMENT_LABEL } from "./leads-ui";
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

export function JobsTable(props: Props) {
  const { rows, sort, onSort, selectedIds, onToggleRow, onToggleAllPage, allPageSelected, onOpenJob, onAction } = props;
  return (
    <div className="scrollbar-thin h-full overflow-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
          <tr className="border-b border-border text-[13px] font-normal text-muted-foreground">
            <th className="w-10 py-3 pl-4 pr-2 text-left sm:pl-6"><Check checked={allPageSelected} onChange={onToggleAllPage} /></th>
            {COLS.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-3 py-3 text-left font-normal">
                {c.sortable ? (
                  <button
                    onClick={() => onSort(c.key)}
                    className={cn("inline-flex items-center gap-1 transition-colors hover:text-foreground", sort?.key === c.key && "text-foreground")}
                  >
                    <ColHead label={c.label} />
                    {sort?.key === c.key ? (
                      sort.dir === "asc" ? <ArrowUp className="size-3 text-brand" /> : <ArrowDown className="size-3 text-brand" />
                    ) : <ChevronsUpDown className="size-3 opacity-40" />}
                  </button>
                ) : c.label}
              </th>
            ))}
            <th className="w-10 pr-4 sm:pr-6" />
          </tr>
        </thead>
        <tbody>
          {rows.map((j) => {
            const selected = selectedIds.has(j.id);
            return (
              <tr
                key={j.id}
                onClick={() => onOpenJob(j)}
                className={cn("group cursor-pointer border-b border-border transition-colors hover:bg-surface/60", selected && "bg-brand/[0.05] hover:bg-brand/[0.07]")}
              >
                <td className="py-2.5 pl-4 pr-2 sm:pl-6" onClick={(e) => e.stopPropagation()}><Check checked={selected} onChange={() => onToggleRow(j.id)} /></td>
                <td className="px-3 py-2.5">
                  <button onClick={(e) => { e.stopPropagation(); onOpenJob(j); }} className="text-left font-medium text-foreground transition-colors hover:text-brand">{j.title}</button>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand">{JOB_SENIORITY_LABEL[j.seniority]}</span>
                    <span className="tabular-nums">{salary(j)}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold", TONES[avatarTone(j.company)])}>{j.companyLogoText}</span>
                    <span className="line-clamp-1 font-medium">{j.company}</span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <span>{j.location}</span>
                  <span className="ml-1.5 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{WORK_MODE_LABEL[j.workMode]}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{EMPLOYMENT_LABEL[j.employmentType]}</td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">{postedLabel(j.postedDaysAgo)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">{j.companySize}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {j.technologies.slice(0, 3).map((t) => (
                      <span key={t} className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium">{t}</span>
                    ))}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5"><HiringSignalChip signal={j.hiringSignal} /></td>
                <td className="py-2.5 pl-2 pr-4 sm:pr-6" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu
                    trigger={
                      <button
                        className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-[opacity,background-color] hover:bg-surface hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                        aria-label="Actions"
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                    }
                  >
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

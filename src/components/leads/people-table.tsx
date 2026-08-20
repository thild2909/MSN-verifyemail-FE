"use client";
import * as React from "react";
import {
  Mail, Phone, Linkedin, ChevronsUpDown, ArrowUp, ArrowDown, MoreHorizontal,
  Bookmark, ListPlus, BadgeCheck, MailSearch, Building2, Workflow, ExternalLink,
} from "lucide-react";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Avatar, CompanyLogo, EmailStatusChip } from "./leads-ui";
import type { Person, SortState } from "@/lib/leads/types";

export type PeopleAction =
  | "save" | "add_list" | "find_email" | "verify_email" | "find_phone"
  | "view_linkedin" | "view_company" | "add_workflow";

interface Props {
  rows: Person[];
  visibleColumns: Set<string>;
  sort: SortState | null;
  onSort: (key: string) => void;
  selectedIds: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAllPage: () => void;
  allPageSelected: boolean;
  onOpenPerson: (p: Person) => void;
  onAction: (action: PeopleAction, p: Person) => void;
}

const COLS: { key: string; label: string; sortable?: boolean }[] = [
  { key: "name", label: "Name", sortable: true },
  { key: "jobTitle", label: "Job Title", sortable: true },
  { key: "company", label: "Company", sortable: true },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "location", label: "Location", sortable: true },
  { key: "linkedin", label: "LinkedIn" },
];

function Check({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      role="checkbox"
      aria-checked={checked}
      className={cn(
        "flex size-4 items-center justify-center rounded border transition-colors",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:border-primary/50",
      )}
    >
      {checked && (
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

export function PeopleTable(props: Props) {
  const { rows, visibleColumns, sort, onSort, selectedIds, onToggleRow, onToggleAllPage, allPageSelected, onOpenPerson, onAction } = props;
  const [revealed, setRevealed] = React.useState<Set<string>>(new Set());
  const reveal = (id: string) => setRevealed((s) => new Set(s).add(id));

  const show = (key: string) => visibleColumns.has(key);

  return (
    <div className="scrollbar-thin h-full overflow-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b">
            <th className="w-10 px-3 py-2.5 text-left">
              <Check checked={allPageSelected} onChange={onToggleAllPage} />
            </th>
            {COLS.filter((c) => show(c.key)).map((c) => (
              <th key={c.key} className="whitespace-nowrap px-3 py-2.5 text-left font-medium text-muted-foreground">
                {c.sortable ? (
                  <button onClick={() => onSort(c.key)} className="inline-flex items-center gap-1 hover:text-foreground">
                    {c.label}
                    {sort?.key === c.key ? (
                      sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                    ) : (
                      <ChevronsUpDown className="size-3 opacity-40" />
                    )}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
            <th className="sticky right-0 z-10 w-px bg-card px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const selected = selectedIds.has(p.id);
            const emailShown = revealed.has(`e_${p.id}`) || p.emailStatus !== "unavailable";
            const phoneShown = revealed.has(`p_${p.id}`);
            return (
              <tr
                key={p.id}
                onClick={() => onOpenPerson(p)}
                className={cn(
                  "group cursor-pointer border-b transition-colors hover:bg-muted/40",
                  selected && "bg-primary/[0.04]",
                )}
              >
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <Check checked={selected} onChange={() => onToggleRow(p.id)} />
                </td>

                {show("name") && (
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={p.name} seed={p.id} />
                      <button
                        onClick={(e) => { e.stopPropagation(); onOpenPerson(p); }}
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {p.name}
                      </button>
                    </div>
                  </td>
                )}

                {show("jobTitle") && (
                  <td className="max-w-[220px] px-3 py-2">
                    <span className="line-clamp-1 text-muted-foreground">{p.jobTitle}</span>
                  </td>
                )}

                {show("company") && (
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <CompanyLogo text={p.companyLogoText} seed={p.companyId} />
                      <span className="line-clamp-1">{p.company}</span>
                    </div>
                  </td>
                )}

                {show("email") && (
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    {emailShown ? (
                      <div className="flex flex-col">
                        <EmailStatusChip status={p.emailStatus} />
                        <span className="text-xs text-muted-foreground">{p.email}</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => { reveal(`e_${p.id}`); onAction("find_email", p); }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-xs font-medium hover:border-primary/50 hover:text-primary"
                      >
                        <Mail className="size-3.5" /> Access email
                      </button>
                    )}
                  </td>
                )}

                {show("phone") && (
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    {p.phoneAvailable ? (
                      phoneShown ? (
                        <span className="text-xs text-muted-foreground">{p.phone}</span>
                      ) : (
                        <button
                          onClick={() => { reveal(`p_${p.id}`); onAction("find_phone", p); }}
                          className="inline-flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-xs font-medium hover:border-primary/50 hover:text-primary"
                        >
                          <Phone className="size-3.5" /> Access Mobile
                        </button>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                )}

                {show("location") && (
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{p.location}</td>
                )}

                {show("linkedin") && (
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    {p.linkedinAvailable ? (
                      <button onClick={() => onAction("view_linkedin", p)} className="text-muted-foreground hover:text-primary" aria-label="View LinkedIn">
                        <Linkedin className="size-4" />
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                )}

                {/* Row actions — quick icons on hover + More menu */}
                <td className="sticky right-0 bg-card px-3 py-2 group-hover:bg-muted/40" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-0.5">
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <IconBtn label="Save lead" onClick={() => onAction("save", p)}><Bookmark className="size-4" /></IconBtn>
                      <IconBtn label="Verify email" onClick={() => onAction("verify_email", p)}><BadgeCheck className="size-4" /></IconBtn>
                      <IconBtn label="Add to list" onClick={() => onAction("add_list", p)}><ListPlus className="size-4" /></IconBtn>
                    </div>
                    <DropdownMenu
                      trigger={<button className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="More actions"><MoreHorizontal className="size-4" /></button>}
                    >
                      <DropdownItem onClick={() => onAction("save", p)}><Bookmark /> Save lead</DropdownItem>
                      <DropdownItem onClick={() => onAction("add_list", p)}><ListPlus /> Add to list</DropdownItem>
                      <DropdownItem onClick={() => onAction("find_email", p)}><MailSearch /> Find email</DropdownItem>
                      <DropdownItem onClick={() => onAction("verify_email", p)}><BadgeCheck /> Verify email</DropdownItem>
                      <DropdownItem onClick={() => onAction("find_phone", p)}><Phone /> Find phone</DropdownItem>
                      <DropdownSeparator />
                      <DropdownItem onClick={() => onAction("view_linkedin", p)}><Linkedin /> View LinkedIn</DropdownItem>
                      <DropdownItem onClick={() => onAction("view_company", p)}><Building2 /> View company</DropdownItem>
                      <DropdownItem onClick={() => onAction("add_workflow", p)}><Workflow /> Add to workflow</DropdownItem>
                      <DropdownItem onClick={() => onOpenPerson(p)}><ExternalLink /> Open details</DropdownItem>
                    </DropdownMenu>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-primary">
      {children}
    </button>
  );
}

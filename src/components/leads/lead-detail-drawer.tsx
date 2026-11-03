"use client";
import * as React from "react";
import {
  BadgeCheck, Phone, Linkedin, Bookmark, ListPlus, MailSearch, Workflow, Check, Building2, Sparkles,
} from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IconTile, Pill, TONES, avatarTone } from "@/components/common/kit";
import { ScoreBar, PEOPLE_SENIORITY_LABEL } from "./leads-ui";
import type { Person } from "@/lib/leads/types";
import type { PeopleAction } from "./people-table";

export function LeadDetailDrawer({
  person, open, onOpenChange, onAction,
}: {
  person: Person | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (action: PeopleAction, p: Person) => void;
}) {
  if (!person) return null;
  const p = person;
  const initials = p.name.split(" ").map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  return (
    <Drawer open={open} onOpenChange={onOpenChange} className="max-w-md">
      {/* Header */}
      <div className="border-b border-border p-5 pr-12 sm:p-6 sm:pr-12">
        <div className="flex items-start gap-3.5">
          <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-xl text-sm font-semibold", TONES[avatarTone(p.name)])}>
            {initials}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-semibold leading-tight tracking-tight">{p.name}</h2>
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{p.jobTitle}</p>
            <p className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-medium text-brand">
              <Building2 className="size-3.5" strokeWidth={1.75} /> {p.company}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Pill tone="brand">{PEOPLE_SENIORITY_LABEL[p.seniority]}</Pill>
          {p.emailStatus === "verified" && <Pill tone="valid"><BadgeCheck className="size-3" /> Verified email</Pill>}
          <Pill tone="muted" className="tabular-nums">ICP {p.icpScore}</Pill>
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => onAction("save", p)}><Bookmark /> Save Lead</Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => onAction("add_list", p)}><ListPlus /> Add to List</Button>
        </div>
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        {/* Contact */}
        <Section title="Contact">
          <div className="divide-y divide-border rounded-lg border border-border">
            <ContactRow ok={p.emailStatus === "verified"} icon={BadgeCheck} label={p.emailStatus === "verified" ? "Verified Email" : "Email"} value={p.email} />
            <ContactRow ok={p.phoneAvailable} icon={Phone} label="Mobile" value={p.phone ?? "Not available"} />
            <ContactRow ok={p.linkedinAvailable} icon={Linkedin} label="LinkedIn" value={p.linkedinAvailable ? "Profile available" : "Not available"} />
          </div>
        </Section>

        {/* Professional */}
        <Section title="Professional">
          <FactList>
            <Fact label="Current role" value={p.jobTitle} />
            <Fact label="Seniority" value={PEOPLE_SENIORITY_LABEL[p.seniority]} />
            <Fact label="Company" value={p.company} />
            <Fact label="Location" value={p.location} />
          </FactList>
        </Section>

        {/* AI Insights */}
        <Section title="AI Insights">
          <div className="rounded-lg border border-border bg-surface/50 p-3.5">
            <div className="mb-1.5 flex items-center justify-between text-[13px]">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Sparkles className="size-3.5 text-brand" strokeWidth={1.75} /> ICP Score
              </span>
              <span className="font-semibold tabular-nums">{p.icpScore} / 100</span>
            </div>
            <ScoreBar value={p.icpScore} />
            <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Why this lead?</p>
            <ul className="space-y-1.5">
              {p.insights.map((r) => (
                <li key={r} className="flex items-start gap-2 text-[13px]">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]">
                    <Check className="size-3" strokeWidth={2.25} />
                  </span>
                  {r}
                </li>
              ))}
            </ul>
          </div>
        </Section>

        {/* Company */}
        <Section title="Company">
          <FactList>
            <Fact label="Employees" value={p.companySize} />
            <Fact label="Industry" value={p.industry} />
            <div className="flex items-start justify-between gap-4 px-3 py-2.5">
              <span className="text-[13px] text-muted-foreground">Technology</span>
              <div className="flex flex-wrap justify-end gap-1">
                {p.technologies.map((t) => (
                  <span key={t} className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] font-medium">{t}</span>
                ))}
              </div>
            </div>
          </FactList>
        </Section>

        {/* Actions */}
        <Section title="Actions">
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={() => onAction("find_email", p)}><MailSearch /> Find Email</Button>
            <Button size="sm" variant="outline" onClick={() => onAction("verify_email", p)}><BadgeCheck /> Verify Email</Button>
            <Button size="sm" variant="outline" onClick={() => onAction("find_phone", p)}><Phone /> Find Mobile</Button>
            <Button size="sm" variant="outline" onClick={() => onAction("view_company", p)}><Building2 /> View Company</Button>
            <Button size="sm" variant="brand" className="col-span-2" onClick={() => onAction("add_workflow", p)}><Workflow /> Add to Workflow</Button>
          </div>
        </Section>
      </div>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function FactList({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-border rounded-lg border border-border">{children}</div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5 text-[13px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">{value}</span>
    </div>
  );
}

function ContactRow({ ok, icon, label, value }: { ok: boolean; icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <IconTile icon={icon} tone={ok ? "valid" : "muted"} size="sm" />
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{value}</p>
      </div>
    </div>
  );
}

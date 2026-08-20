"use client";
import * as React from "react";
import {
  BadgeCheck, Phone, Linkedin, Bookmark, ListPlus, MailSearch, Workflow, Check, Building2,
} from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Avatar, ScoreBar, PEOPLE_SENIORITY_LABEL } from "./leads-ui";
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

  return (
    <Drawer open={open} onOpenChange={onOpenChange} className="max-w-md">
      {/* Header */}
      <div className="border-b p-6 pr-10">
        <div className="flex items-start gap-3">
          <Avatar name={p.name} seed={p.id} className="size-12 text-sm" />
          <div className="min-w-0">
            <h2 className="text-lg font-bold">{p.name}</h2>
            <p className="text-sm text-muted-foreground">{p.jobTitle}</p>
            <p className="mt-0.5 text-sm font-medium text-primary">{p.company}</p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => onAction("save", p)}><Bookmark className="size-4" /> Save Lead</Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => onAction("add_list", p)}><ListPlus className="size-4" /> Add to List</Button>
        </div>
      </div>

      <div className="divide-y">
        {/* Contact */}
        <Section title="Contact">
          <ContactRow ok={p.emailStatus === "verified"} icon={BadgeCheck} label={p.emailStatus === "verified" ? "Verified Email" : "Email"} value={p.email} />
          <ContactRow ok={p.phoneAvailable} icon={Phone} label="Mobile" value={p.phone ?? "Not available"} />
          <ContactRow ok={p.linkedinAvailable} icon={Linkedin} label="LinkedIn" value={p.linkedinAvailable ? "Profile available" : "Not available"} />
        </Section>

        {/* Professional */}
        <Section title="Professional">
          <Fact label="Current role" value={p.jobTitle} />
          <Fact label="Seniority" value={PEOPLE_SENIORITY_LABEL[p.seniority]} />
          <Fact label="Company" value={p.company} />
          <Fact label="Location" value={p.location} />
        </Section>

        {/* AI Insights */}
        <Section title="AI Insights">
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">ICP Score</span>
              <span className="font-semibold tabular-nums">{p.icpScore} / 100</span>
            </div>
            <ScoreBar value={p.icpScore} />
          </div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Why this lead?</p>
          <ul className="space-y-1.5">
            {p.insights.map((r) => (
              <li key={r} className="flex items-center gap-2 text-sm">
                <Check className="size-4 text-[hsl(var(--valid))]" /> {r}
              </li>
            ))}
          </ul>
        </Section>

        {/* Company */}
        <Section title="Company">
          <Fact label="Employees" value={p.companySize} />
          <Fact label="Industry" value={p.industry} />
          <div className="flex items-start justify-between gap-4 py-1.5">
            <span className="text-sm text-muted-foreground">Technology</span>
            <div className="flex flex-wrap justify-end gap-1">
              {p.technologies.map((t) => (
                <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium">{t}</span>
              ))}
            </div>
          </div>
        </Section>

        {/* Actions */}
        <Section title="Actions">
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={() => onAction("find_email", p)}><MailSearch className="size-4" /> Find Email</Button>
            <Button size="sm" variant="outline" onClick={() => onAction("verify_email", p)}><BadgeCheck className="size-4" /> Verify Email</Button>
            <Button size="sm" variant="outline" onClick={() => onAction("find_phone", p)}><Phone className="size-4" /> Find Mobile</Button>
            <Button size="sm" variant="outline" onClick={() => onAction("view_company", p)}><Building2 className="size-4" /> View Company</Button>
            <Button size="sm" variant="outline" className="col-span-2" onClick={() => onAction("add_workflow", p)}><Workflow className="size-4" /> Add to Workflow</Button>
          </div>
        </Section>
      </div>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="p-6">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function ContactRow({ ok, icon: Icon, label, value }: { ok: boolean; icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className={cn("flex size-7 items-center justify-center rounded-md", ok ? "bg-valid/12 text-[hsl(var(--valid))]" : "bg-muted text-muted-foreground")}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{value}</p>
      </div>
    </div>
  );
}

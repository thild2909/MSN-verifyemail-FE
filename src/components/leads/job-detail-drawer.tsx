"use client";
import * as React from "react";
import { MapPin, Briefcase, Clock, DollarSign, Users, Building2, Bookmark, Workflow } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Pill, TONES, avatarTone } from "@/components/common/kit";
import { postedLabel } from "@/lib/leads/data";
import { HiringSignalChip, JOB_SENIORITY_LABEL, WORK_MODE_LABEL, EMPLOYMENT_LABEL } from "./leads-ui";
import type { Job } from "@/lib/leads/types";
import type { JobAction } from "./jobs-table";

export function JobDetailDrawer({
  job, open, onOpenChange, onAction,
}: {
  job: Job | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAction: (action: JobAction, j: Job) => void;
}) {
  if (!job) return null;
  const j = job;
  const salary = `$${Math.round(j.salaryMin / 1000)}k – $${Math.round(j.salaryMax / 1000)}k`;

  return (
    <Drawer open={open} onOpenChange={onOpenChange} className="max-w-md">
      <div className="border-b border-border p-5 pr-12 sm:p-6 sm:pr-12">
        <div className="flex items-start gap-3.5">
          <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl text-xs font-bold", TONES[avatarTone(j.company)])}>
            {j.companyLogoText}
          </span>
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold leading-tight tracking-tight">{j.title}</h2>
            <p className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-brand">
              <Building2 className="size-3.5" strokeWidth={1.75} /> {j.company}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Pill tone="brand">{JOB_SENIORITY_LABEL[j.seniority]}</Pill>
          <Pill tone="muted">{WORK_MODE_LABEL[j.workMode]}</Pill>
          <span className="ml-1"><HiringSignalChip signal={j.hiringSignal} /></span>
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => onAction("find_decision_makers", j)}><Users /> Find decision makers</Button>
          <Button size="sm" variant="outline" onClick={() => onAction("save", j)}><Bookmark /> Save</Button>
        </div>
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <Section title="Overview">
          <div className="divide-y divide-border rounded-lg border border-border">
            <Row icon={MapPin} label="Location" value={j.location} />
            <Row icon={Briefcase} label="Employment" value={EMPLOYMENT_LABEL[j.employmentType]} />
            <Row icon={Clock} label="Posted" value={postedLabel(j.postedDaysAgo)} />
            <Row icon={DollarSign} label="Salary range" value={salary} />
            <Row icon={Users} label="Company size" value={`${j.companySize} employees`} />
          </div>
        </Section>

        <Section title="Technologies">
          <div className="flex flex-wrap gap-1.5">
            {j.technologies.map((t) => (
              <span key={t} className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-medium">{t}</span>
            ))}
          </div>
        </Section>

        <Section title="Hiring signal">
          <div className="rounded-lg border border-border bg-surface/50 p-3.5 text-[13px]">
            <div className="mb-1.5"><HiringSignalChip signal={j.hiringSignal} /></div>
            <p className="leading-relaxed text-muted-foreground">
              {j.hiringSignal === "strong"
                ? "Posted recently and actively hiring. A strong sign this team is growing, so reach out now."
                : j.hiringSignal === "medium"
                  ? "Open role posted a while ago. Worth watching and reaching out to the hiring team."
                  : "Older posting with lower urgency, but still a sign of where the team is headed."}
            </p>
          </div>
        </Section>

        <Section title="Actions">
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={() => onAction("view_company", j)}><Building2 /> View company</Button>
            <Button size="sm" variant="outline" onClick={() => onAction("add_workflow", j)}><Workflow /> Add to workflow</Button>
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

function Row({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5 text-[13px]">
      <span className="inline-flex shrink-0 items-center gap-2 text-muted-foreground"><Icon className="size-3.5" strokeWidth={1.75} /> {label}</span>
      <span className="min-w-0 truncate text-right font-medium">{value}</span>
    </div>
  );
}

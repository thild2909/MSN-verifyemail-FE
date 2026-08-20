"use client";
import * as React from "react";
import { MapPin, Briefcase, Clock, DollarSign, Users, Building2, Bookmark, Workflow } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { postedLabel } from "@/lib/leads/data";
import { CompanyLogo, HiringSignalChip, JOB_SENIORITY_LABEL, WORK_MODE_LABEL, EMPLOYMENT_LABEL } from "./leads-ui";
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
      <div className="border-b p-6 pr-10">
        <h2 className="text-lg font-bold">{j.title}</h2>
        <div className="mt-1 flex items-center gap-2">
          <CompanyLogo text={j.companyLogoText} seed={j.companyId} />
          <span className="text-sm font-medium text-primary">{j.company}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">{JOB_SENIORITY_LABEL[j.seniority]}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">{WORK_MODE_LABEL[j.workMode]}</span>
          <HiringSignalChip signal={j.hiringSignal} />
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => onAction("find_decision_makers", j)}><Users className="size-4" /> Find decision makers</Button>
          <Button size="sm" variant="outline" onClick={() => onAction("save", j)}><Bookmark className="size-4" /> Save</Button>
        </div>
      </div>

      <div className="divide-y">
        <section className="p-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overview</h3>
          <div className="space-y-2.5">
            <Row icon={MapPin} label="Location" value={j.location} />
            <Row icon={Briefcase} label="Employment" value={EMPLOYMENT_LABEL[j.employmentType]} />
            <Row icon={Clock} label="Posted" value={postedLabel(j.postedDaysAgo)} />
            <Row icon={DollarSign} label="Salary range" value={salary} />
            <Row icon={Users} label="Company size" value={`${j.companySize} employees`} />
          </div>
        </section>

        <section className="p-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Technologies</h3>
          <div className="flex flex-wrap gap-1.5">{j.technologies.map((t) => <span key={t} className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">{t}</span>)}</div>
        </section>

        <section className="p-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hiring signal</h3>
          <div className="rounded-lg border bg-muted/20 px-3 py-3 text-sm">
            <div className="mb-1"><HiringSignalChip signal={j.hiringSignal} /></div>
            <p className="text-muted-foreground">
              {j.hiringSignal === "strong"
                ? "Posted recently and actively hiring — a strong signal this team is growing. Reach out to the decision makers now."
                : j.hiringSignal === "medium"
                  ? "Open role with moderate recency — worth watching and reaching out to the hiring team."
                  : "Older posting — lower urgency, but still a signal of the team's direction."}
            </p>
          </div>
        </section>

        <section className="p-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</h3>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={() => onAction("view_company", j)}><Building2 className="size-4" /> View company</Button>
            <Button size="sm" variant="outline" onClick={() => onAction("add_workflow", j)}><Workflow className="size-4" /> Add to workflow</Button>
          </div>
        </section>
      </div>
    </Drawer>
  );
}

function Row({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="inline-flex items-center gap-2 text-muted-foreground"><Icon className="size-4" /> {label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

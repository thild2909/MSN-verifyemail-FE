"use client";
import * as React from "react";
import { Linkedin, Mail, MapPin, Building2, BadgeCheck, ExternalLink } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { Avatar } from "./leads-ui";
import { CompanyLogo, VerificationBadge, LlmBadge } from "./collect-ui";
import { SENIORITY_LABEL, type CollectedPerson } from "@/lib/leads/people-types";

const linkedinHref = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://${v}`);

export function PersonDetailDrawer({ person, open, onOpenChange }: { person: CollectedPerson | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {person && (
        <div className="flex flex-col">
          {/* Header */}
          <div className="border-b p-5 pr-12">
            <div className="flex items-start gap-3">
              <Avatar name={person.name} seed={person.id} className="size-12 text-base" />
              <div className="min-w-0">
                <h2 className="text-lg font-bold leading-tight">{person.name}</h2>
                <p className="text-sm text-muted-foreground">{person.title?.value ?? SENIORITY_LABEL[person.seniority]}</p>
                <div className="mt-1.5 flex items-center gap-2 text-sm">
                  <CompanyLogo domain={person.companyDomain} text={person.companyLogoText} className="size-5 text-[9px]" />
                  <span>{person.company}</span>
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{SENIORITY_LABEL[person.seniority]}</span>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{person.confidence}% confidence</span>
              {person.linkedin && (
                <a href={linkedinHref(String(person.linkedin.value))} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-input px-2.5 py-0.5 text-xs font-medium hover:border-primary/50 hover:text-primary">
                  <Linkedin className="size-3" /> LinkedIn <ExternalLink className="size-3" />
                </a>
              )}
              {person.llmVerification && <LlmBadge v={person.llmVerification} showLabel />}
            </div>
            {person.llmVerification && (
              <p className={cn("mt-2 rounded-md px-2.5 py-1.5 text-xs", person.llmVerification.status === "mismatch" ? "bg-[hsl(var(--invalid))]/10 text-[hsl(var(--invalid))]" : "bg-muted/50 text-muted-foreground")}>
                <span className="font-medium">AI check ({person.llmVerification.confidence}%):</span> {person.llmVerification.reason}
              </p>
            )}
          </div>

          {/* Contact */}
          <Section title="Contact">
            <Row icon={Mail} label="Email">
              {person.email ? (
                <div className="flex flex-col items-end gap-1">
                  <span className="font-medium">{String(person.email.value)}</span>
                  <div className="flex items-center gap-1.5">
                    {person.emailVerification
                      ? <VerificationBadge ev={person.emailVerification} showScore />
                      : <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{person.emailKind === "found" ? "Found on web" : "Pattern guess"}</span>}
                  </div>
                </div>
              ) : <span className="text-muted-foreground">—</span>}
            </Row>
            <Row icon={Linkedin} label="LinkedIn">
              {person.linkedin
                ? <a href={linkedinHref(String(person.linkedin.value))} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{String(person.linkedin.value)}</a>
                : <span className="text-muted-foreground">—</span>}
            </Row>
            <Row icon={MapPin} label="Location">{person.location ?? <span className="text-muted-foreground">—</span>}</Row>
            <Row icon={Building2} label="Company">{person.company}</Row>
          </Section>

          {/* Provenance */}
          <Section title="How we found them">
            <div className="space-y-2">
              {person.collection.map((a, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
                  <BadgeCheck className={cn("mt-0.5 size-3.5 shrink-0", a.status === "ok" ? "text-[hsl(var(--valid))]" : "text-muted-foreground")} />
                  <div className="min-w-0">
                    <p className="font-medium capitalize">{a.source} · {a.status}</p>
                    {a.detail && <p className="truncate text-muted-foreground" title={a.detail}>{a.detail}</p>}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">Emails are derived from the company domain (first.last@) and confirmed by the verification pass — they are not scraped from LinkedIn.</p>
            </div>
          </Section>
        </div>
      )}
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b p-5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function Row({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="inline-flex items-center gap-2 text-muted-foreground"><Icon className="size-4" /> {label}</span>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  );
}

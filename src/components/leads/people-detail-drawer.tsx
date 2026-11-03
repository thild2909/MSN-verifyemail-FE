"use client";
import * as React from "react";
import { Linkedin, Mail, MapPin, Building2, BadgeCheck, ExternalLink, Phone, Twitter, Facebook, Briefcase, Users, Globe, DollarSign, Calendar, Cpu, Tag, Sparkles, CircleDashed } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { Pill, TONES, type Tone } from "@/components/common/kit";
import { Avatar } from "./leads-ui";
import { CompanyLogo, VerificationBadge, LlmBadge } from "./collect-ui";
import { SENIORITY_LABEL, isUnconfirmedEmail, type CollectedPerson, type PersonSeniority } from "@/lib/leads/people-types";

const linkedinHref = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://${v}`);

const SENIORITY_TONE: Record<PersonSeniority, Tone> = {
  founder: "valid",
  c_level: "brand",
  president: "violet",
  vp: "risky",
  other: "muted",
};

const LINK = "font-medium text-brand hover:underline";

export function PersonDetailDrawer({ person, open, onOpenChange }: { person: CollectedPerson | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} className="max-w-xl">
      {person && (
        <div className="flex flex-col pr-[5px]">
          {/* Header */}
          <div className="relative overflow-hidden border-b border-border p-5 pr-12">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-brand/[0.06] to-transparent" />
            <div className="relative flex items-start gap-3.5">
              <Avatar name={person.name} seed={person.id} className="size-12 rounded-xl text-base ring-4 ring-card" />
              <div className="min-w-0">
                <h2 className="text-lg font-semibold leading-tight tracking-tight">{person.name}</h2>
                {person.altName && person.altName !== person.name && (
                  <p className="mt-0.5 text-xs text-muted-foreground" title={`Full name recovered from LinkedIn; the email was found using "${person.altName}"`}>
                    Also: <span className="font-medium text-foreground/80">{person.altName}</span>
                  </p>
                )}
                <p className="mt-0.5 text-sm text-muted-foreground">{person.title?.value ?? person.headline ?? SENIORITY_LABEL[person.seniority]}</p>
                {person.department && <p className="text-xs text-muted-foreground">{person.department}</p>}
                <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-[13px] font-medium shadow-xs">
                  <CompanyLogo domain={person.companyDomain} text={person.companyLogoText} className="size-5 text-[9px]" />
                  <span className="min-w-0 truncate">{person.company}</span>
                </div>
              </div>
            </div>
            <div className="relative mt-4 flex flex-wrap items-center gap-1.5">
              <Pill tone={SENIORITY_TONE[person.seniority]} className="normal-case">{SENIORITY_LABEL[person.seniority]}</Pill>
              <Pill tone="muted" className="normal-case tabular-nums">{person.confidence}% confidence</Pill>
              {person.llmVerification && <LlmBadge v={person.llmVerification} showLabel />}
              {person.linkedin && (
                <a href={linkedinHref(String(person.linkedin.value))} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold transition-opacity hover:opacity-80", TONES.sky)}>
                  <Linkedin className="size-3" /> LinkedIn <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            {person.llmVerification && (
              <div className={cn(
                "relative mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
                person.llmVerification.status === "mismatch"
                  ? "border-[hsl(var(--invalid)/0.25)] bg-[hsl(var(--invalid)/0.06)] text-[hsl(var(--invalid))]"
                  : "border-border bg-surface text-muted-foreground",
              )}>
                <Sparkles className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
                <p><span className="font-semibold">AI check ({person.llmVerification.confidence}%):</span> {person.llmVerification.reason}</p>
              </div>
            )}
          </div>

          {/* Contact */}
          <Section title="Contact">
            <Row icon={Mail} label="Email">
              {isUnconfirmedEmail(person) ? (
                <Pill tone="muted" className="normal-case">Not found</Pill>
              ) : person.email ? (
                <div className="flex flex-col items-end gap-1">
                  <span className="break-all font-medium">{String(person.email.value)}</span>
                  <div className="flex items-center gap-1.5">
                    {person.emailVerification
                      ? <VerificationBadge ev={person.emailVerification} showScore />
                      : <Pill tone="muted" className="normal-case">Not verified</Pill>}
                  </div>
                </div>
              ) : <Empty />}
            </Row>
            <Row icon={Linkedin} label="LinkedIn">
              {person.linkedin
                ? <a href={linkedinHref(String(person.linkedin.value))} target="_blank" rel="noreferrer" className={cn(LINK, "break-all")}>{String(person.linkedin.value)}</a>
                : <Empty />}
            </Row>
            {person.mobile && <Row icon={Phone} label="Mobile"><span className="tabular-nums">{person.mobile}</span></Row>}
            {person.twitter && <Row icon={Twitter} label="Twitter"><a href={linkedinHref(person.twitter)} target="_blank" rel="noreferrer" className={LINK}>{person.twitter.replace(/^https?:\/\/(www\.)?/i, "")}</a></Row>}
            {person.facebook && <Row icon={Facebook} label="Facebook"><a href={linkedinHref(person.facebook)} target="_blank" rel="noreferrer" className={LINK}>{person.facebook.replace(/^https?:\/\/(www\.)?/i, "")}</a></Row>}
            <Row icon={MapPin} label="Location">{person.location ?? <Empty />}</Row>
            <Row icon={Building2} label="Company">{person.company}</Row>
          </Section>

          {(person.companyDomain || person.companyIndustry || person.companyEmployees || person.companyPhone || person.companyEmail || person.companyLinkedin || person.companyFoundedYear || person.companyRevenue || person.companyFunding) && (
            <Section title="Company">
              {person.companyDomain && <Row icon={Globe} label="Website"><a href={`https://${person.companyDomain}`} target="_blank" rel="noreferrer" className={LINK}>{person.companyDomain}</a></Row>}
              {person.companyEmail && <Row icon={Mail} label="Company email"><a href={`mailto:${person.companyEmail}`} className={cn(LINK, "break-all")}>{person.companyEmail}</a></Row>}
              {person.companyLinkedin && <Row icon={Linkedin} label="Company LinkedIn"><a href={linkedinHref(person.companyLinkedin)} target="_blank" rel="noreferrer" className={cn(LINK, "break-all")}>{person.companyLinkedin.replace(/^https?:\/\/(www\.)?/i, "")}</a></Row>}
              {person.companyIndustry && <Row icon={Briefcase} label="Industry">{person.companyIndustry}</Row>}
              {person.companyEmployees && <Row icon={Users} label="Employees"><span className="tabular-nums">{person.companyEmployees}</span></Row>}
              {person.companyFoundedYear && <Row icon={Calendar} label="Founded"><span className="tabular-nums">{person.companyFoundedYear}</span></Row>}
              {person.companyRevenue && <Row icon={DollarSign} label="Annual revenue"><span className="tabular-nums">{person.companyRevenue}</span></Row>}
              {person.companyFunding && <Row icon={DollarSign} label="Total funding"><span className="tabular-nums">{person.companyFunding}</span></Row>}
              {person.companyPhone && <Row icon={Phone} label="Company phone"><span className="tabular-nums">{person.companyPhone}</span></Row>}
            </Section>
          )}

          {(person.companyShortDescription || person.companySeoDescription || person.companyTechnologies || person.keywords) && (
            <Section title="About" plain>
              <div className="space-y-3">
                {person.companyShortDescription && <TextBlock label="Short description">{person.companyShortDescription}</TextBlock>}
                {person.companySeoDescription && person.companySeoDescription !== person.companyShortDescription && (
                  <TextBlock label="SEO description">{person.companySeoDescription}</TextBlock>
                )}
                {person.companyTechnologies && <TagList icon={Cpu} label="Technologies" value={person.companyTechnologies} />}
                {person.keywords && <TagList icon={Tag} label="Keywords" value={person.keywords} />}
              </div>
            </Section>
          )}

          {/* Provenance */}
          <Section title="How we found them" plain>
            <ol className="relative space-y-2">
              {person.collection.map((a, i) => {
                const ok = a.status === "ok";
                return (
                  <li key={i} className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-xs">
                    <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md", ok ? TONES.valid : TONES.muted)}>
                      {ok ? <BadgeCheck className="size-3" strokeWidth={2} /> : <CircleDashed className="size-3" strokeWidth={2} />}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium capitalize">{a.source} <span className="text-muted-foreground">· {a.status}</span></p>
                      {a.detail && <p className="truncate text-muted-foreground" title={a.detail}>{a.detail}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">Emails are built from the company domain (first.last@) and confirmed by the verification pass. They are not scraped from LinkedIn.</p>
          </Section>
        </div>
      )}
    </Drawer>
  );
}

function Empty() {
  return <span className="text-muted-foreground/60">—</span>;
}

/** Labelled block. Row children sit in one bordered, divided list; `plain` leaves layout to the children. */
function Section({ title, children, plain }: { title: string; children: React.ReactNode; plain?: boolean }) {
  return (
    <div className="px-5 py-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {plain ? children : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">{children}</div>
      )}
    </div>
  );
}

function Row({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
      <span className="inline-flex shrink-0 items-center gap-2 text-muted-foreground"><Icon className="size-3.5" strokeWidth={1.75} /> {label}</span>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  );
}

/** Full-width labelled text (descriptions) — wraps instead of truncating. */
function TextBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 text-[13px]">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <p className="leading-relaxed text-foreground">{children}</p>
    </div>
  );
}

/** Comma/semicolon/pipe-separated value rendered as chips (technologies, keywords). */
function TagList({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  const items = value.split(/[,;|]/).map((s) => s.trim()).filter(Boolean).slice(0, 60);
  if (!items.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 text-[13px]">
      <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground"><Icon className="size-3.5" strokeWidth={1.75} /> {label} <span className="tabular-nums text-muted-foreground/70">{items.length}</span></span>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((t, i) => <span key={i} className="rounded-md bg-surface px-1.5 py-0.5 text-xs text-foreground">{t}</span>)}
      </div>
    </div>
  );
}

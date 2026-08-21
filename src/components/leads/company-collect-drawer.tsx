"use client";
import * as React from "react";
import { Copy, Star, Server, Check, X, RotateCw, Ban, MinusCircle, Search, Globe, Linkedin, Database, Users } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { SourceBadge, COLLECT_STATUS_META, SimulatedTag, isSimulatedSource, VerificationBadge, CompanyLogo } from "./collect-ui";
import type { CollectedCompany, CollectionAttempt, SourcedField } from "@/lib/leads/collect-types";

export function CompanyCollectDrawer({ company, open, onOpenChange }: { company: CollectedCompany | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  if (!company) return null;
  const c = company;
  const copy = (v: string) => { navigator.clipboard?.writeText(v); toast({ variant: "success", title: "Copied", description: v }); };
  const st = COLLECT_STATUS_META[c.status];

  const fields: { label: string; field: SourcedField<string | number> | null; copyable?: boolean }[] = [
    { label: "Website", field: c.website, copyable: true },
    { label: "Contact email", field: c.contactEmail, copyable: true },
    { label: "Phone", field: c.phone, copyable: true },
    { label: "LinkedIn", field: c.linkedin, copyable: true },
    { label: "Twitter / X", field: c.twitter },
    { label: "Facebook", field: c.facebook },
    { label: "Location", field: c.address },
    { label: "Industry", field: c.industry },
    { label: "Employees", field: c.employees },
    { label: "Revenue", field: c.revenue },
    { label: "Founded", field: c.founded },
  ];
  const legalFields: { label: string; field: SourcedField<string | number> | null; copyable?: boolean }[] = [
    { label: "Legal name", field: c.legalName },
    { label: "Jurisdiction", field: c.jurisdiction },
    { label: "Reg. number", field: c.registrationNumber, copyable: true },
    { label: "Incorporated", field: c.incorporated },
  ];
  const res = c.resolution;

  return (
    <Drawer open={open} onOpenChange={onOpenChange} className="max-w-lg">
      <div className="border-b p-6 pr-10">
        <div className="flex items-start gap-3">
          <CompanyLogo domain={c.domainGuess} text={c.logoText || c.inputName.slice(0, 2).toUpperCase()} className="size-12 rounded-xl text-base" />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{c.inputName}</h2>
            <p className="text-sm text-muted-foreground">{c.inputLocation}{c.domainGuess ? ` · ${c.domainGuess}` : ""}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", st.className)}>{st.label}</span>
              {res && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700" title={`Resolver confidence · ${res.provider}`}>{res.confidence}% match</span>}
              {res?.cacheHit && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground" title="Served from the 30-day cache"><Database className="size-3" /> Cached</span>}
              {c.emailVerification && <VerificationBadge ev={c.emailVerification} showScore />}
              {c.mapsRating && <span className="inline-flex items-center gap-1 text-xs text-[hsl(var(--risky))]"><Star className="size-3.5 fill-current" /> {c.mapsRating.value}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="divide-y">
        {/* Resolution — what the resolver found before crawling */}
        {res && (
          <section className="p-6">
            <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Search className="size-3.5" /> Resolution</h3>
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <ResRow icon={Globe} label="Website" value={res.website} onCopy={res.website ? () => copy(res.website!) : undefined} />
              <ResRow icon={Linkedin} label="LinkedIn" value={res.linkedin} onCopy={res.linkedin ? () => copy(res.linkedin!) : undefined} />
              <div className="flex items-center justify-between gap-3 border-t pt-2 text-[11px] text-muted-foreground">
                <span>via <span className="font-medium text-foreground">{res.provider}</span>{res.cacheHit ? " · cached" : ""}</span>
                <span className="truncate" title={res.query}>“{res.query}”</span>
              </div>
              {c.verification && (
                <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
                  {c.matchScore != null && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary" title="Entity-resolution match score">score {c.matchScore}</span>
                  )}
                  <VCheck ok={c.verification.name_match} label="Name" />
                  <VCheck ok={c.verification.location_match} label="Location" />
                  <VCheck ok={c.verification.website_match} label="Website" />
                  <VCheck ok={c.verification.linkedin_match} label="LinkedIn" />
                  <VCheck ok={c.verification.cross_verified} label="Cross-verified" strong />
                </div>
              )}
            </div>
          </section>
        )}

        {/* Collected data */}
        <section className="p-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Collected data</h3>
          <div className="space-y-2">
            {fields.filter((f) => f.field).map(({ label, field, copyable }) => (
              <FieldRow key={label} label={label} field={field!} copyable={copyable} onCopy={copy} />
            ))}
          </div>

          {legalFields.some((f) => f.field) && (
            <>
              <h4 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Legal entity</h4>
              <div className="space-y-2">
                {legalFields.filter((f) => f.field).map(({ label, field, copyable }) => (
                  <FieldRow key={label} label={label} field={field!} copyable={copyable} onCopy={copy} />
                ))}
              </div>
            </>
          )}
          {c.technologies && (
            <div className="mt-3">
              <div className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground">Technologies <SourceBadge source={c.technologies.source} /></div>
              <div className="flex flex-wrap gap-1">{c.technologies.value.map((t) => <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium">{t}</span>)}</div>
            </div>
          )}
          {c.description && <p className="mt-3 text-sm text-muted-foreground">{c.description.value}</p>}
        </section>

        {/* Collection log */}
        <section className="p-6">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Server className="size-3.5" /> Collection log</h3>
          <ul className="space-y-1.5">
            {c.collection.map((a, i) => (
              <li key={i} className="rounded-lg border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                    <SourceBadge source={a.source} showLabel />
                    {a.simulated && <SimulatedTag />}
                    {a.cacheHit && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"><Database className="size-3" /> cache</span>}
                  </span>
                  <AttemptStatus a={a} />
                </div>
                {a.detail && <p className="mt-1 truncate text-[11px] text-muted-foreground" title={a.detail}>{a.detail}</p>}
                <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Server className="size-3" /> {a.proxy ?? "direct (no proxy)"}</span>
                  <span>{a.ms}ms{a.pages != null ? ` · ${a.pages} pages` : ""} · {a.fieldsFound} fields</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Drawer>
  );
}

function FieldRow({ label, field, copyable, onCopy }: { label: string; field: SourcedField<string | number>; copyable?: boolean; onCopy: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[13px] font-medium">{String(field.value)}</span>
        {field.agreement && field.agreement > 1 && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-[hsl(var(--valid))]/12 px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--valid))]" title={`${field.agreement} sources agree`}>
            <Users className="size-3" /> {field.agreement}
          </span>
        )}
        <SourceBadge source={field.source} />
        {isSimulatedSource(field.source) && <SimulatedTag />}
        {copyable && <button onClick={() => onCopy(String(field.value))} className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Copy"><Copy className="size-3.5" /></button>}
      </div>
    </div>
  );
}

function VCheck({ ok, label, strong }: { ok: boolean; label: string; strong?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        ok ? "bg-[hsl(var(--valid))]/12 text-[hsl(var(--valid))]" : "bg-muted text-muted-foreground",
        strong && ok && "ring-1 ring-[hsl(var(--valid))]/40",
      )}
    >
      {ok ? <Check className="size-3" /> : <X className="size-3" />} {label}
    </span>
  );
}

function ResRow({ icon: Icon, label, value, onCopy }: { icon: React.ElementType; label: string; value: string | null; onCopy?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><Icon className="size-3.5" /> {label}</span>
      {value ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{value}</span>
          {onCopy && <button onClick={onCopy} className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Copy"><Copy className="size-3.5" /></button>}
        </div>
      ) : <span className="text-xs text-muted-foreground">not found</span>}
    </div>
  );
}

function AttemptStatus({ a }: { a: CollectionAttempt }) {
  const map = {
    ok: { icon: Check, label: "OK", className: "text-[hsl(var(--valid))]" },
    retried: { icon: RotateCw, label: "Retried", className: "text-[hsl(var(--risky))]" },
    rate_limited: { icon: X, label: "Rate limited", className: "text-[hsl(var(--invalid))]" },
    blocked: { icon: Ban, label: "Blocked", className: "text-[hsl(var(--invalid))]" },
    skipped: { icon: MinusCircle, label: "Skipped", className: "text-muted-foreground" },
  }[a.status];
  return <span className={cn("inline-flex items-center gap-1 text-xs font-medium", map.className)}><map.icon className="size-3.5" /> {map.label}</span>;
}

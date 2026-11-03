"use client";
import * as React from "react";
import { Copy, Star, Server, Check, X, RotateCw, Ban, MinusCircle, Search, Globe, Linkedin, Database, Users, Sparkles, Building2, Landmark, Cpu, Clock, CheckCircle2, SearchX, XCircle, Loader2 } from "lucide-react";
import { Pill, type Tone } from "@/components/common/kit";
import { Drawer } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { SourceBadge, COLLECT_STATUS_META, VerificationBadge, CompanyLogo } from "./collect-ui";
import type { CollectedCompany, CollectionAttempt, SourcedField, CollectStatus } from "@/lib/leads/collect-types";

export function CompanyCollectDrawer({ company, open, onOpenChange }: { company: CollectedCompany | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  if (!company) return null;
  const c = company;
  const copy = (v: string) => { navigator.clipboard?.writeText(v); toast({ variant: "success", title: "Copied", description: v }); };

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
      {/* Header */}
      <div className="relative border-b border-border px-5 pb-5 pt-6 pr-12 sm:px-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-brand/[0.05] to-transparent" />
        <div className="relative flex items-start gap-3.5">
          <CompanyLogo domain={c.domainGuess} text={c.logoText || c.inputName.slice(0, 2).toUpperCase()} className="size-12 shrink-0 rounded-xl text-base shadow-xs" />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight">{c.inputName}</h2>
            <p className="truncate text-[13px] text-muted-foreground">{c.inputLocation}{c.domainGuess ? ` · ${c.domainGuess}` : ""}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <StatusPill status={c.status} />
              {res && <span title={`Resolver confidence · ${res.provider}`}><Pill tone="sky" className="normal-case"><Search className="size-3" strokeWidth={2} /> <span className="tabular-nums">{res.confidence}%</span> match</Pill></span>}
              {res?.cacheHit && <span title="Served from the 30-day cache"><Pill tone="muted" className="normal-case"><Database className="size-3" strokeWidth={2} /> Cached</Pill></span>}
              {c.emailVerification && <VerificationBadge ev={c.emailVerification} showScore />}
              {c.mapsRating && <Pill tone="risky" className="normal-case"><Star className="size-3 fill-current" strokeWidth={2} /> <span className="tabular-nums">{c.mapsRating.value}</span></Pill>}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6 px-5 py-5 sm:px-6">
        {/* Resolution — what the resolver found before crawling */}
        {res && (
          <section>
            <SectionLabel icon={Search}>Resolution</SectionLabel>
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="divide-y divide-border">
                <ResRow icon={Globe} label="Website" value={res.website} onCopy={res.website ? () => copy(res.website!) : undefined} />
                <ResRow icon={Linkedin} label="LinkedIn" value={res.linkedin} onCopy={res.linkedin ? () => copy(res.linkedin!) : undefined} />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border bg-surface/60 px-3 py-2 text-[11px] text-muted-foreground">
                <span className="shrink-0">via <span className="font-medium text-foreground">{res.provider}</span>{res.cacheHit ? " · cached" : ""}</span>
                <span className="truncate font-mono" title={res.query}>“{res.query}”</span>
              </div>
              {c.verification && (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2.5">
                  {c.matchScore != null && (
                    <span title="Entity-resolution match score"><Pill tone="brand" className="normal-case">score <span className="tabular-nums">{c.matchScore}</span></Pill></span>
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
        <section>
          <SectionLabel icon={Building2}>Collected data</SectionLabel>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {fields.filter((f) => f.field).map(({ label, field, copyable }) => (
              <FieldRow key={label} label={label} field={field!} copyable={copyable} onCopy={copy} />
            ))}
          </div>

          {legalFields.some((f) => f.field) && (
            <>
              <SectionLabel icon={Landmark} className="mt-5">Legal entity</SectionLabel>
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {legalFields.filter((f) => f.field).map(({ label, field, copyable }) => (
                  <FieldRow key={label} label={label} field={field!} copyable={copyable} onCopy={copy} />
                ))}
              </div>
            </>
          )}
          {c.technologies && (
            <div className="mt-4 rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[13px] text-muted-foreground"><Cpu className="size-3.5" strokeWidth={1.75} /> Technologies <SourceBadge source={c.technologies.source} /></div>
              <div className="flex flex-wrap gap-1">{c.technologies.value.map((t) => <span key={t} className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] font-medium">{t}</span>)}</div>
            </div>
          )}
          {c.description && <p className="mt-4 rounded-lg bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-muted-foreground">{c.description.value}</p>}
        </section>

        {/* AI report — structured qualification fields captured on save from Find with AI */}
        {c.aiReport && Object.keys(c.aiReport.values ?? {}).length > 0 ? (
          <section>
            <SectionLabel icon={Sparkles}>
              AI report
              {c.aiReport.model && <span className="font-normal normal-case tracking-normal text-muted-foreground/70">· {c.aiReport.model}</span>}
            </SectionLabel>
            <dl className="divide-y divide-border overflow-hidden rounded-lg border border-brand/20 bg-brand/[0.03]">
              {Object.entries(c.aiReport.values).map(([key, value]) => (
                <div key={key} className="px-3 py-2.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{c.aiReport?.labels?.[key] ?? key}</dt>
                  <dd className="mt-0.5 text-[13px] leading-relaxed"><AiValue value={value} /></dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {/* Collection log */}
        <section>
          <SectionLabel icon={Server}>Collection log</SectionLabel>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {c.collection.map((a, i) => (
              <li key={i} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
                    <SourceBadge source={a.source} showLabel />
                    {a.cacheHit && <Pill tone="muted" className="normal-case"><Database className="size-3" strokeWidth={2} /> cache</Pill>}
                  </span>
                  <AttemptStatus a={a} />
                </div>
                {a.detail && <p className="mt-1 truncate text-[11px] text-muted-foreground" title={a.detail}>{a.detail}</p>}
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="inline-flex min-w-0 items-center gap-1 truncate"><Server className="size-3 shrink-0" /> <span className="truncate font-mono">{a.proxy ?? "direct (no proxy)"}</span></span>
                  <span className="shrink-0 tabular-nums">{a.ms}ms{a.pages != null ? ` · ${a.pages} pages` : ""} · {a.fieldsFound} fields</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Drawer>
  );
}

function SectionLabel({ icon: Icon, children, className }: { icon: React.ElementType; children: React.ReactNode; className?: string }) {
  return (
    <h3 className={cn("mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", className)}>
      <Icon className="size-3.5" strokeWidth={1.75} /> {children}
    </h3>
  );
}

const STATUS_PILL: Record<CollectStatus, { tone: Tone; icon: React.ElementType }> = {
  pending: { tone: "muted", icon: Clock },
  collecting: { tone: "risky", icon: Loader2 },
  enriched: { tone: "valid", icon: CheckCircle2 },
  not_found: { tone: "muted", icon: SearchX },
  failed: { tone: "invalid", icon: XCircle },
};
function StatusPill({ status }: { status: CollectStatus }) {
  const meta = COLLECT_STATUS_META[status] ?? COLLECT_STATUS_META.enriched;
  const p = STATUS_PILL[status] ?? STATUS_PILL.enriched;
  const Icon = p.icon;
  return (
    <Pill tone={p.tone} className="whitespace-nowrap normal-case">
      <Icon className={cn("size-3", status === "collecting" && "animate-spin")} strokeWidth={2} />
      {meta.label}
    </Pill>
  );
}

function FieldRow({ label, field, copyable, onCopy }: { label: string; field: SourcedField<string | number>; copyable?: boolean; onCopy: (v: string) => void }) {
  return (
    <div className="group flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-surface/60">
      <span className="shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[13px] font-medium">{String(field.value)}</span>
        {field.agreement && field.agreement > 1 && (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-[hsl(var(--valid)/0.12)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[hsl(var(--valid))]" title={`${field.agreement} sources agree`}>
            <Users className="size-3" /> {field.agreement}
          </span>
        )}
        <SourceBadge source={field.source} />
        {copyable && <button onClick={() => onCopy(String(field.value))} className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Copy"><Copy className="size-3.5" /></button>}
      </div>
    </div>
  );
}

// Domain like "grab.com" (no scheme/path) — linkified alongside full URLs.
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/**
 * Render a dynamic AI-report value. Multi-line values (e.g. "Direct job source"
 * with several URLs) split into one clickable link per line; bare domains/URLs
 * are linkified; everything else stays wrapped plain text.
 */
function AiValue({ value }: { value: string }) {
  const v = (value || "").trim();
  if (!v || v === "—") return <span className="text-muted-foreground">—</span>;
  const tokens = v.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const link = (t: string) => {
    const isUrl = /^https?:\/\//i.test(t);
    if (!isUrl && !DOMAIN_RE.test(t)) return <span className="whitespace-pre-wrap break-words">{t}</span>;
    const href = isUrl ? t : `https://${t}`;
    const label = t.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    return <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-brand hover:underline">{label}</a>;
  };
  if (tokens.length > 1) {
    return <div className="flex flex-col gap-0.5">{tokens.map((t, i) => <span key={i}>{link(t)}</span>)}</div>;
  }
  return link(tokens[0]);
}

function VCheck({ ok, label, strong }: { ok: boolean; label: string; strong?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
        ok ? "bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]" : "bg-surface text-muted-foreground",
        strong && ok && "ring-1 ring-[hsl(var(--valid)/0.4)]",
      )}
    >
      {ok ? <Check className="size-3" /> : <X className="size-3" />} {label}
    </span>
  );
}

function ResRow({ icon: Icon, label, value, onCopy }: { icon: React.ElementType; label: string; value: string | null; onCopy?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-muted-foreground"><Icon className="size-3.5" strokeWidth={1.75} /> {label}</span>
      {value ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{value}</span>
          {onCopy && <button onClick={onCopy} className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Copy"><Copy className="size-3.5" /></button>}
        </div>
      ) : <span className="text-xs italic text-muted-foreground">not found</span>}
    </div>
  );
}

function AttemptStatus({ a }: { a: CollectionAttempt }) {
  const map = {
    ok: { icon: Check, label: "OK", className: "bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]" },
    retried: { icon: RotateCw, label: "Retried", className: "bg-[hsl(var(--risky)/0.14)] text-[hsl(var(--risky))]" },
    rate_limited: { icon: X, label: "Rate limited", className: "bg-[hsl(var(--invalid)/0.1)] text-[hsl(var(--invalid))]" },
    blocked: { icon: Ban, label: "Blocked", className: "bg-[hsl(var(--invalid)/0.1)] text-[hsl(var(--invalid))]" },
    skipped: { icon: MinusCircle, label: "Skipped", className: "bg-surface text-muted-foreground" },
  }[a.status];
  return <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", map.className)}><map.icon className="size-3" /> {map.label}</span>;
}

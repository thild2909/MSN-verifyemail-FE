"use client";
import * as React from "react";
import { Copy, Star, Server, Check, X, RotateCw, Ban, MinusCircle } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { SOURCE_META, SourceBadge, COLLECT_STATUS_META } from "./collect-ui";
import type { CollectedCompany, CollectionAttempt, SourcedField } from "@/lib/leads/collect-types";

export function CompanyCollectDrawer({ company, open, onOpenChange }: { company: CollectedCompany | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  if (!company) return null;
  const c = company;
  const copy = (v: string) => { navigator.clipboard?.writeText(v); toast({ variant: "success", title: "Copied", description: v }); };
  const st = COLLECT_STATUS_META[c.status];

  const fields: { label: string; field: SourcedField<string | number> | null; copyable?: boolean }[] = [
    { label: "Website", field: c.website, copyable: true },
    { label: "Email domain", field: c.emailDomain },
    { label: "Contact email", field: c.contactEmail, copyable: true },
    { label: "Phone", field: c.phone, copyable: true },
    { label: "LinkedIn", field: c.linkedin, copyable: true },
    { label: "Twitter / X", field: c.twitter },
    { label: "Facebook", field: c.facebook },
    { label: "Address", field: c.address },
    { label: "Industry", field: c.industry },
    { label: "Employees", field: c.employees },
    { label: "Revenue", field: c.revenue },
    { label: "Founded", field: c.founded },
  ];

  return (
    <Drawer open={open} onOpenChange={onOpenChange} className="max-w-lg">
      <div className="border-b p-6 pr-10">
        <div className="flex items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-base font-bold text-primary">{c.logoText || c.inputName.slice(0, 2).toUpperCase()}</span>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{c.inputName}</h2>
            <p className="text-sm text-muted-foreground">{c.inputLocation}{c.domainGuess ? ` · ${c.domainGuess}` : ""}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", st.className)}>{st.label}</span>
              {c.mapsRating && <span className="inline-flex items-center gap-1 text-xs text-[hsl(var(--risky))]"><Star className="size-3.5 fill-current" /> {c.mapsRating.value}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="divide-y">
        {/* Collected data */}
        <section className="p-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Collected data</h3>
          <div className="space-y-2">
            {fields.filter((f) => f.field).map(({ label, field, copyable }) => (
              <div key={label} className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">{label}</span>
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium">{String(field!.value)}</span>
                  <SourceBadge source={field!.source} />
                  {copyable && <button onClick={() => copy(String(field!.value))} className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Copy"><Copy className="size-3.5" /></button>}
                </div>
              </div>
            ))}
          </div>
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
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm font-medium"><SourceBadge source={a.source} showLabel /></span>
                  <AttemptStatus a={a} />
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Server className="size-3" /> {a.proxy ?? "direct (no proxy)"}</span>
                  <span>{a.ms}ms · {a.fieldsFound} fields</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Drawer>
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

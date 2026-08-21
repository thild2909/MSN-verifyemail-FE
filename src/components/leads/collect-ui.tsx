"use client";
/**
 * Presentation helpers for company multi-source collection — source badges,
 * status chips, and a sourced-field renderer (value + which source found it).
 */
import * as React from "react";
import { Linkedin, Globe, MapPin, Share2, Boxes, Search, Landmark, BookText, FlaskConical, ShieldCheck, ShieldX, ShieldAlert, ShieldQuestion, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SIMULATED_SOURCES, type CollectStatus, type CollectionSource, type SourcedField, type EmailVerification, type LlmVerdict } from "@/lib/leads/collect-types";

export const SOURCE_META: Record<CollectionSource, { label: string; icon: LucideIcon; className: string }> = {
  search: { label: "Resolver", icon: Search, className: "bg-blue-100 text-blue-700" },
  website: { label: "Website", icon: Globe, className: "bg-indigo-100 text-indigo-700" },
  opencorporates: { label: "OpenCorporates", icon: Landmark, className: "bg-teal-100 text-teal-700" },
  linkedin: { label: "LinkedIn", icon: Linkedin, className: "bg-sky-100 text-sky-700" },
  google_maps: { label: "Google Maps", icon: MapPin, className: "bg-emerald-100 text-emerald-700" },
  directory: { label: "Directory", icon: BookText, className: "bg-amber-100 text-amber-700" },
  social: { label: "Social", icon: Share2, className: "bg-violet-100 text-violet-700" },
  other: { label: "Other", icon: Boxes, className: "bg-amber-100 text-amber-700" },
};

export const isSimulatedSource = (s: CollectionSource) => SIMULATED_SOURCES.includes(s);

/** Company logo: the real favicon for the resolved domain, initials on failure. */
export function CompanyLogo({ domain, text, className }: { domain?: string | null; text: string; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  const box = cn("flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 font-bold text-primary", className);
  const host = (domain ?? "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
  if (!host || failed) return <span className={box}>{text}</span>;
  return (
    <span className={cn(box, "bg-white")}>
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
        alt=""
        width={64}
        height={64}
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-full object-contain p-0.5"
      />
    </span>
  );
}

/** Small honest "Simulated" tag for gated sources whose values are mock. */
export function SimulatedTag({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground", className)} title="This source is simulated (ToS-gated — mock values, real rotation/rate-limit behaviour)">
      <FlaskConical className="size-3" /> Simulated
    </span>
  );
}

export function SourceBadge({ source, showLabel = false }: { source: CollectionSource; showLabel?: boolean }) {
  const m = SOURCE_META[source];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium", m.className)} title={`Source: ${m.label}`}>
      <m.icon className="size-3" />
      {showLabel && m.label}
    </span>
  );
}

/** A collected field: its value plus a small badge for the source that found it. */
export function Sourced({ field, mono }: { field: SourcedField<React.ReactNode> | null; mono?: boolean }) {
  if (!field) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("truncate text-[13px]", mono && "font-mono text-xs")}>{field.value}</span>
      <SourceBadge source={field.source} />
    </span>
  );
}

/* ------------------------- email verification --------------------------- */

const VERIFY_META: Record<string, { label: string; className: string; icon: LucideIcon }> = {
  valid: { label: "Valid", className: "bg-[hsl(var(--valid))]/12 text-[hsl(var(--valid))]", icon: ShieldCheck },
  invalid: { label: "Invalid", className: "bg-[hsl(var(--invalid))]/12 text-[hsl(var(--invalid))]", icon: ShieldX },
  disposable: { label: "Disposable", className: "bg-[hsl(var(--invalid))]/12 text-[hsl(var(--invalid))]", icon: ShieldX },
  catch_all: { label: "Catch-all", className: "bg-[hsl(var(--risky))]/12 text-[hsl(var(--risky))]", icon: ShieldAlert },
  role: { label: "Role", className: "bg-[hsl(var(--risky))]/12 text-[hsl(var(--risky))]", icon: ShieldAlert },
  risky: { label: "Risky", className: "bg-[hsl(var(--risky))]/12 text-[hsl(var(--risky))]", icon: ShieldAlert },
  unknown: { label: "Unknown", className: "bg-muted text-muted-foreground", icon: ShieldQuestion },
};

/** Deliverability badge for a collected contact email. */
export function VerificationBadge({ ev, showScore = false }: { ev: EmailVerification; showScore?: boolean }) {
  const m = VERIFY_META[ev.status] ?? VERIFY_META.unknown;
  const title = `Email ${m.label}${ev.score != null ? ` · score ${ev.score}` : ""} · via ${ev.provider}`;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium", m.className)} title={title}>
      <m.icon className="size-3" /> {m.label}{showScore ? ` ${ev.score}` : ""}
      {ev.provider === "mock" && <span className="opacity-60">·sim</span>}
    </span>
  );
}

const LLM_META: Record<LlmVerdict["status"], { label: string; className: string; icon: LucideIcon }> = {
  verified: { label: "AI ✓", className: "bg-[hsl(var(--valid))]/12 text-[hsl(var(--valid))]", icon: ShieldCheck },
  mismatch: { label: "AI ✗", className: "bg-[hsl(var(--invalid))]/12 text-[hsl(var(--invalid))]", icon: ShieldX },
  uncertain: { label: "AI ?", className: "bg-muted text-muted-foreground", icon: ShieldQuestion },
};

/** DeepSeek cross-check verdict chip (hover shows the model's reason). */
export function LlmBadge({ v, showLabel = false }: { v: LlmVerdict; showLabel?: boolean }) {
  const m = LLM_META[v.status] ?? LLM_META.uncertain;
  const title = `AI verify: ${v.status}${v.confidence ? ` (${v.confidence}%)` : ""} · ${v.reason}${v.suggestion ? ` → ${v.suggestion}` : ""} · ${v.model}`;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium", m.className)} title={title}>
      <Sparkles className="size-3" /> {showLabel ? `${m.label}` : v.status === "mismatch" ? "AI ✗" : v.status === "verified" ? "AI ✓" : "AI ?"}
    </span>
  );
}

export const COLLECT_STATUS_META: Record<CollectStatus, { label: string; className: string }> = {
  pending: { label: "Queued", className: "bg-muted text-muted-foreground" },
  collecting: { label: "Collecting", className: "bg-risky/12 text-[hsl(var(--risky))]" },
  enriched: { label: "Enriched", className: "bg-valid/12 text-[hsl(var(--valid))]" },
  not_found: { label: "Not found", className: "bg-muted text-muted-foreground" },
  failed: { label: "Failed", className: "bg-invalid/12 text-[hsl(var(--invalid))]" },
};

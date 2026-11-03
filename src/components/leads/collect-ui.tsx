"use client";
/**
 * Presentation helpers for company multi-source collection — source badges,
 * status chips, and a sourced-field renderer (value + which source found it).
 */
import * as React from "react";
import { Linkedin, Globe, MapPin, Share2, Boxes, Search, Landmark, BookText, ShieldCheck, ShieldX, ShieldAlert, ShieldQuestion, Sparkles, Brain, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONES } from "@/components/common/kit";

/** Shared badge shape — token tint supplied per meta entry. */
const CHIP = "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-4";
import { type CollectStatus, type CollectionSource, type SourcedField, type EmailVerification, type LlmVerdict } from "@/lib/leads/collect-types";

export const SOURCE_META: Record<CollectionSource, { label: string; icon: LucideIcon; className: string }> = {
  search: { label: "Resolver", icon: Search, className: TONES.brand },
  website: { label: "Website", icon: Globe, className: TONES.brand },
  opencorporates: { label: "OpenCorporates", icon: Landmark, className: TONES.valid },
  linkedin: { label: "LinkedIn", icon: Linkedin, className: TONES.sky },
  google_maps: { label: "Google Maps", icon: MapPin, className: TONES.valid },
  directory: { label: "Directory", icon: BookText, className: TONES.risky },
  social: { label: "Social", icon: Share2, className: TONES.violet },
  llm: { label: "AI (DeepSeek)", icon: Brain, className: TONES.violet },
  other: { label: "Other", icon: Boxes, className: TONES.muted },
};

/** Company logo: the real favicon for the resolved domain, initials on failure. */
export function CompanyLogo({ domain, text, className }: { domain?: string | null; text: string; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  const box = cn("flex shrink-0 select-none items-center justify-center overflow-hidden rounded-lg bg-brand/10 font-bold text-brand ring-1 ring-inset ring-brand/15", className);
  const host = (domain ?? "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
  if (!host || failed) return <span className={box}>{text}</span>;
  return (
    <span className={cn(box, "bg-white ring-black/10 dark:ring-white/10")}>
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


export function SourceBadge({ source, showLabel = false }: { source: CollectionSource; showLabel?: boolean }) {
  const m = SOURCE_META[source];
  return (
    <span className={cn(CHIP, showLabel ? "px-1.5" : "px-1", m.className)} title={`Source: ${m.label}`}>
      <m.icon className="size-3" strokeWidth={2} />
      {showLabel && m.label}
    </span>
  );
}

/** A collected field: its value plus a small badge for the source that found it. */
export function Sourced({ field, mono, showConfidence }: { field: SourcedField<React.ReactNode> | null; mono?: boolean; showConfidence?: boolean }) {
  if (!field) return <span className="text-xs text-muted-foreground/70">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("truncate text-[13px]", mono && "font-mono text-xs")}>{field.value}</span>
      {showConfidence && field.confidence > 0 && (
        <span className={cn(CHIP, "tabular-nums", TONES.muted)} title="Confidence score">
          {field.confidence}%
        </span>
      )}
      <SourceBadge source={field.source} />
    </span>
  );
}

/* ------------------------- email verification --------------------------- */

const VERIFY_META: Record<string, { label: string; className: string; icon: LucideIcon }> = {
  valid: { label: "Valid", className: TONES.valid, icon: ShieldCheck },
  invalid: { label: "Invalid", className: TONES.invalid, icon: ShieldX },
  disposable: { label: "Disposable", className: TONES.invalid, icon: ShieldX },
  catch_all: { label: "Catch-all", className: TONES.risky, icon: ShieldAlert },
  role: { label: "Role", className: TONES.risky, icon: ShieldAlert },
  risky: { label: "Risky", className: TONES.risky, icon: ShieldAlert },
  unknown: { label: "Unknown", className: TONES.muted, icon: ShieldQuestion },
  not_found: { label: "Not found", className: TONES.muted, icon: ShieldQuestion },
};

/** Deliverability badge for a collected contact email. */
export function VerificationBadge({ ev, showScore = false }: { ev: EmailVerification; showScore?: boolean }) {
  const m = VERIFY_META[ev.status] ?? VERIFY_META.unknown;
  const title = `Email ${m.label}${ev.score != null ? ` · score ${ev.score}` : ""} · via ${ev.provider}`;
  return (
    <span className={cn(CHIP, m.className)} title={title}>
      <m.icon className="size-3" strokeWidth={2} /> {m.label}{showScore ? ` ${ev.score}` : ""}
    </span>
  );
}

const LLM_META: Record<LlmVerdict["status"], { label: string; className: string; icon: LucideIcon }> = {
  verified: { label: "AI ✓", className: TONES.valid, icon: ShieldCheck },
  mismatch: { label: "AI ✗", className: TONES.invalid, icon: ShieldX },
  uncertain: { label: "AI ?", className: TONES.muted, icon: ShieldQuestion },
};

/** DeepSeek cross-check verdict chip (hover shows the model's reason). */
export function LlmBadge({ v, showLabel = false }: { v: LlmVerdict; showLabel?: boolean }) {
  const m = LLM_META[v.status] ?? LLM_META.uncertain;
  const title = `AI verify: ${v.status}${v.confidence ? ` (${v.confidence}%)` : ""} · ${v.reason}${v.suggestion ? ` → ${v.suggestion}` : ""} · ${v.model}`;
  return (
    <span className={cn(CHIP, m.className)} title={title}>
      <Sparkles className="size-3" strokeWidth={2} /> {showLabel ? `${m.label}` : v.status === "mismatch" ? "AI ✗" : v.status === "verified" ? "AI ✓" : "AI ?"}
    </span>
  );
}

export const COLLECT_STATUS_META: Record<CollectStatus, { label: string; className: string }> = {
  pending: { label: "Queued", className: TONES.muted },
  collecting: { label: "Collecting", className: TONES.risky },
  enriched: { label: "Enriched", className: TONES.valid },
  not_found: { label: "Not found", className: TONES.muted },
  failed: { label: "Failed", className: TONES.invalid },
};

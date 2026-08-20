/**
 * Presentation helpers for company multi-source collection — source badges,
 * status chips, and a sourced-field renderer (value + which source found it).
 */
import * as React from "react";
import { Linkedin, Globe, MapPin, Share2, Boxes, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CollectStatus, CollectionSource, SourcedField } from "@/lib/leads/collect-types";

export const SOURCE_META: Record<CollectionSource, { label: string; icon: LucideIcon; className: string }> = {
  linkedin: { label: "LinkedIn", icon: Linkedin, className: "bg-sky-100 text-sky-700" },
  website: { label: "Website", icon: Globe, className: "bg-indigo-100 text-indigo-700" },
  google_maps: { label: "Google Maps", icon: MapPin, className: "bg-emerald-100 text-emerald-700" },
  social: { label: "Social", icon: Share2, className: "bg-violet-100 text-violet-700" },
  other: { label: "Other", icon: Boxes, className: "bg-amber-100 text-amber-700" },
};

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

export const COLLECT_STATUS_META: Record<CollectStatus, { label: string; className: string }> = {
  pending: { label: "Queued", className: "bg-muted text-muted-foreground" },
  collecting: { label: "Collecting", className: "bg-risky/12 text-[hsl(var(--risky))]" },
  enriched: { label: "Enriched", className: "bg-valid/12 text-[hsl(var(--valid))]" },
  not_found: { label: "Not found", className: "bg-muted text-muted-foreground" },
  failed: { label: "Failed", className: "bg-invalid/12 text-[hsl(var(--invalid))]" },
};

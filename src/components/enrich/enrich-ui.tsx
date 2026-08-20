/**
 * Shared presentation for enrichment tables — column icons + cell status atoms.
 */
import * as React from "react";
import {
  MailSearch, BadgeCheck, Phone, Linkedin, Building2, Cpu, AtSign, Sparkles,
  Loader2, Circle, Minus, AlertCircle, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { columnSpec } from "@/lib/enrich/columns";
import type { EnrichColumnKind, EnrichRecordType } from "@/lib/types";

export const COLUMN_ICON: Record<string, LucideIcon> = {
  "mail-search": MailSearch,
  "badge-check": BadgeCheck,
  phone: Phone,
  linkedin: Linkedin,
  building: Building2,
  cpu: Cpu,
  "at-sign": AtSign,
  sparkles: Sparkles,
};

export function ColumnIcon({ kind, className }: { kind: EnrichColumnKind; className?: string }) {
  const Icon = COLUMN_ICON[columnSpec(kind).iconKey] ?? Circle;
  return <Icon className={cn("size-4", className)} />;
}

export const RECORD_TYPE_LABEL: Record<EnrichRecordType, string> = {
  people: "People",
  companies: "Companies",
};

/** Small status glyph for a cell that has no value to show. */
export function CellStatusGlyph({ status }: { status: "pending" | "running" | "not_found" | "error" }) {
  if (status === "running") return <Loader2 className="size-3.5 animate-spin text-primary" />;
  if (status === "pending") return <Circle className="size-3 text-muted-foreground/40" />;
  if (status === "error") return <AlertCircle className="size-3.5 text-[hsl(var(--invalid))]" />;
  return <Minus className="size-3.5 text-muted-foreground/50" />; // not_found
}

/** A pill showing the winning provider/source for a found cell. */
export function SourceChip({ source, confidence }: { source: string; confidence: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {source}
      {confidence != null && <span className="tabular-nums opacity-70">{confidence}%</span>}
    </span>
  );
}

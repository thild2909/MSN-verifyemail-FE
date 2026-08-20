/**
 * Shared presentation for finder verdicts, used by BOTH the single and bulk
 * finder panels so they report the same states identically.
 */
import { type LucideIcon, ShieldCheck, ShieldAlert, ShieldX, SearchX } from "lucide-react";
import type { FinderState } from "@/lib/types";

export interface FinderStateMeta {
  icon: LucideIcon;
  /** Long label for the single-finder banner. */
  label: string;
  /** Compact label for the bulk-finder status chip. */
  chip: string;
  /** Tailwind text + subtle background classes. */
  className: string;
}

export const FINDER_STATE_META: Record<FinderState, FinderStateMeta> = {
  verified: {
    icon: ShieldCheck,
    label: "Verified deliverable mailbox",
    chip: "Verified",
    className: "text-[hsl(var(--valid))] bg-[hsl(var(--valid))]/10",
  },
  accept_all: {
    icon: ShieldAlert,
    label: "Plausible but unverified — deliverability not confirmed",
    chip: "Unverified",
    className: "text-[hsl(var(--risky))] bg-[hsl(var(--risky))]/10",
  },
  no_mx: {
    icon: ShieldX,
    label: "This domain can't receive email (no MX)",
    chip: "No MX",
    className: "text-[hsl(var(--invalid))] bg-[hsl(var(--invalid))]/10",
  },
  not_found: {
    icon: SearchX,
    label: "No email found for this person",
    chip: "Not found",
    className: "text-muted-foreground bg-muted",
  },
};

/**
 * A score is only meaningful for a positive result — a confirmed mailbox or a
 * plausible (above-threshold) one. For `not_found` / `no_mx` we never show a
 * score, so a low catch-all guess can't read as a weak positive.
 */
export function scoreIsMeaningful(state: FinderState): boolean {
  return state === "verified" || state === "accept_all";
}

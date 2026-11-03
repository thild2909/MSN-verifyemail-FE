/**
 * Find Leads — shared presentational atoms + label maps used across the
 * People / Companies / Jobs tables and drawers.
 */
import * as React from "react";
import { BadgeCheck, Circle, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONES, avatarTone } from "@/components/common/kit";
import type {
  Department, EmailStatus, EmploymentType, HiringSignal, JobSeniority,
  PeopleSeniority, QualificationTier, WorkMode,
} from "@/lib/leads/types";

/* --------------------------------- labels -------------------------------- */

export const PEOPLE_SENIORITY_LABEL: Record<PeopleSeniority, string> = {
  c_level: "C-Level", vp: "VP", director: "Director", manager: "Manager", staff: "Staff",
};

export const JOB_SENIORITY_LABEL: Record<JobSeniority, string> = {
  entry: "Entry", mid: "Mid", senior: "Senior", lead: "Lead",
  manager: "Manager", director: "Director", vp: "VP", c_level: "C-Level",
};

export const DEPARTMENT_LABEL: Record<Department, string> = {
  engineering: "Engineering", product: "Product", sales: "Sales", marketing: "Marketing",
  operations: "Operations", hr: "HR", finance: "Finance",
};

export const WORK_MODE_LABEL: Record<WorkMode, string> = {
  remote: "Remote", hybrid: "Hybrid", onsite: "On-site",
};

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship",
};

/* ------------------------------- avatar/logo ----------------------------- */

/** Soft, theme-safe tint stable per seed (kit `avatarTone`). */
const toneFor = (seed: string) => TONES[avatarTone(seed)];

export function Avatar({ name, seed, className }: { name: string; seed?: string; className?: string }) {
  const init = name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 select-none items-center justify-center rounded-full text-[11px] font-semibold tracking-wide",
        toneFor(seed ?? name),
        className,
      )}
    >
      {init}
    </span>
  );
}

export function CompanyLogo({ text, seed, className }: { text: string; seed?: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 select-none items-center justify-center rounded-md text-[10px] font-bold ring-1 ring-inset ring-border/60",
        toneFor(seed ?? text),
        className,
      )}
    >
      {text}
    </span>
  );
}

/* --------------------------------- chips --------------------------------- */

const CHIP = "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold";

export function EmailStatusChip({ status }: { status: EmailStatus }) {
  if (status === "verified") {
    return (
      <span className={cn(CHIP, TONES.valid)}>
        <BadgeCheck className="size-3" strokeWidth={2} /> Verified
      </span>
    );
  }
  if (status === "unverified") {
    return (
      <span className={cn(CHIP, TONES.muted)}>
        <Circle className="size-2.5" strokeWidth={2.25} /> Unverified
      </span>
    );
  }
  return <span className="text-[11px] font-medium text-muted-foreground/80">Unavailable</span>;
}

const TIER_CLASS: Record<QualificationTier, string> = {
  Excellent: TONES.valid,
  Good: TONES.brand,
  Fair: TONES.risky,
};

export function QualificationPill({ tier, score }: { tier: QualificationTier; score: number }) {
  return (
    <span className={cn(CHIP, "gap-1.5", TIER_CLASS[tier])}>
      {tier} <span className="tabular-nums opacity-75">{score}</span>
    </span>
  );
}

const SIGNAL_META: Record<HiringSignal, { label: string; className: string }> = {
  strong: { label: "Strong hiring signal", className: TONES.invalid },
  medium: { label: "Hiring signal", className: TONES.risky },
  weak: { label: "Low activity", className: TONES.muted },
};

export function HiringSignalChip({ signal }: { signal: HiringSignal }) {
  const m = SIGNAL_META[signal];
  return (
    <span className={cn(CHIP, m.className)}>
      <Flame className={cn("size-3", signal === "weak" && "opacity-50")} strokeWidth={2} /> {m.label}
    </span>
  );
}

export function ScoreBar({ value, label }: { value: number; label?: string }) {
  const tone = value >= 85 ? "bg-[hsl(var(--valid))]" : value >= 60 ? "bg-brand" : "bg-[hsl(var(--risky))]";
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 min-w-10 flex-1 overflow-hidden rounded-full bg-border">
        <div className={cn("h-full rounded-full transition-[width] duration-300", tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right text-[11px] font-semibold tabular-nums text-foreground/80">{label ?? `${value}%`}</span>
    </div>
  );
}

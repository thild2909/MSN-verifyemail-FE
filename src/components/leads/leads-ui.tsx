/**
 * Find Leads — shared presentational atoms + label maps used across the
 * People / Companies / Jobs tables and drawers.
 */
import * as React from "react";
import { BadgeCheck, Circle, Flame } from "lucide-react";
import { cn, seededRandom } from "@/lib/utils";
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

const AVATAR_TONES = [
  "bg-indigo-100 text-indigo-700", "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700", "bg-sky-100 text-sky-700",
  "bg-rose-100 text-rose-700", "bg-violet-100 text-violet-700",
];

export function Avatar({ name, seed, className }: { name: string; seed?: string; className?: string }) {
  const tone = AVATAR_TONES[Math.floor(seededRandom(seed ?? name) * AVATAR_TONES.length)];
  const init = name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", tone, className)}>
      {init}
    </span>
  );
}

export function CompanyLogo({ text, seed, className }: { text: string; seed?: string; className?: string }) {
  const tone = AVATAR_TONES[Math.floor(seededRandom(seed ?? text) * AVATAR_TONES.length)];
  return (
    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold", tone, className)}>
      {text}
    </span>
  );
}

/* --------------------------------- chips --------------------------------- */

export function EmailStatusChip({ status }: { status: EmailStatus }) {
  if (status === "verified") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--valid))]">
        <BadgeCheck className="size-3.5" /> Verified
      </span>
    );
  }
  if (status === "unverified") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <Circle className="size-3" /> Unverified
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">Unavailable</span>;
}

const TIER_CLASS: Record<QualificationTier, string> = {
  Excellent: "bg-valid/12 text-[hsl(var(--valid))]",
  Good: "bg-primary/10 text-primary",
  Fair: "bg-risky/12 text-[hsl(var(--risky))]",
};

export function QualificationPill({ tier, score }: { tier: QualificationTier; score: number }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", TIER_CLASS[tier])}>
      {tier} <span className="tabular-nums opacity-80">{score}</span>
    </span>
  );
}

const SIGNAL_META: Record<HiringSignal, { label: string; className: string }> = {
  strong: { label: "Strong hiring signal", className: "text-[hsl(var(--invalid))]" },
  medium: { label: "Hiring signal", className: "text-[hsl(var(--risky))]" },
  weak: { label: "Low activity", className: "text-muted-foreground" },
};

export function HiringSignalChip({ signal }: { signal: HiringSignal }) {
  const m = SIGNAL_META[signal];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", m.className)}>
      <Flame className={cn("size-3.5", signal === "weak" && "opacity-50")} /> {m.label}
    </span>
  );
}

export function ScoreBar({ value, label }: { value: number; label?: string }) {
  const tone = value >= 85 ? "bg-[hsl(var(--valid))]" : value >= 60 ? "bg-primary" : "bg-[hsl(var(--risky))]";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${value}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">{label ?? `${value}%`}</span>
    </div>
  );
}

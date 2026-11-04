"use client";
import { User, Building2, Briefcase, Sparkles, Linkedin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeadsTab } from "@/lib/leads/types";

/*
 * Tab bar for Find Leads, styled like the Outreach suite's detail tabs: each tab
 * carries a meaning-coloured glyph (same hue family as table-header icons), the
 * active tab gets a tinted icon tile, bolder label and a rounded brand underline.
 */
const TABS: { key: LeadsTab; label: string; icon: React.ElementType; tone: string; tile: string }[] = [
  {
    key: "people", label: "People", icon: User,
    tone: "text-[hsl(234_78%_60%)] dark:text-[hsl(234_90%_76%)]",
    tile: "bg-[hsl(234_78%_60%/0.12)]",
  },
  {
    key: "companies", label: "Companies", icon: Building2,
    tone: "text-[hsl(280_62%_55%)] dark:text-[hsl(280_80%_76%)]",
    tile: "bg-[hsl(280_62%_55%/0.12)]",
  },
  {
    key: "jobs", label: "Jobs", icon: Briefcase,
    tone: "text-[hsl(var(--risky))]",
    tile: "bg-[hsl(var(--risky)/0.14)]",
  },
  {
    key: "linkedin", label: "LinkedIn Jobs", icon: Linkedin,
    tone: "text-[hsl(199_89%_40%)] dark:text-[hsl(199_90%_65%)]",
    tile: "bg-[hsl(199_89%_48%/0.12)]",
  },
  {
    key: "ai", label: "Find with AI", icon: Sparkles,
    tone: "text-[hsl(330_72%_54%)] dark:text-[hsl(330_85%_72%)]",
    tile: "bg-[hsl(330_72%_54%/0.12)]",
  },
];

export function LeadsTabs({ active, onChange }: { active: LeadsTab; onChange: (t: LeadsTab) => void }) {
  return (
    <div role="tablist" aria-label="Lead sources" className="scroll-rail no-scrollbar -mx-1 -mb-px flex items-end gap-0.5 px-1 pb-px">
      {TABS.map((t) => {
        const on = active === t.key;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={cn(
              "group relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-lg px-3 pb-3 pt-2 text-sm transition-colors sm:px-3.5",
              on ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:bg-surface/70 hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-md transition-colors",
                on ? t.tile : "bg-transparent group-hover:bg-card",
              )}
            >
              <Icon className={cn("size-4", t.tone)} strokeWidth={on ? 2 : 1.75} />
            </span>
            {t.label}
            {/* underline */}
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-2 -bottom-px h-[2px] rounded-full transition-all",
                on ? "bg-brand" : "bg-transparent group-hover:bg-border",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

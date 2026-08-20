"use client";
import { User, Building2, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeadsTab } from "@/lib/leads/types";

const TABS: { key: LeadsTab; label: string; icon: React.ElementType }[] = [
  { key: "people", label: "People", icon: User },
  { key: "companies", label: "Companies", icon: Building2 },
  { key: "jobs", label: "Jobs", icon: Briefcase },
];

export function LeadsTabs({ active, onChange }: { active: LeadsTab; onChange: (t: LeadsTab) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-xl border bg-card p-1">
      {TABS.map((t) => {
        const on = active === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              on ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        );
      })}
    </div>
  );
}

"use client";
import * as React from "react";
import { User, Upload } from "lucide-react";
import { FinderPanel } from "./finder-panel";
import { BulkFinderPanel } from "./bulk-finder-panel";
import { cn } from "@/lib/utils";

type Mode = "single" | "bulk";

export function FinderTabs() {
  const [mode, setMode] = React.useState<Mode>("single");

  return (
    <div className="space-y-5">
      <div className="inline-flex gap-1 rounded-lg border bg-card p-1">
        <Tab active={mode === "single"} onClick={() => setMode("single")} icon={User} label="Single finder" />
        <Tab active={mode === "bulk"} onClick={() => setMode("bulk")} icon={Upload} label="Bulk finder" />
      </div>

      {mode === "single" ? <FinderPanel /> : <BulkFinderPanel />}
    </div>
  );
}

function Tab({
  active, onClick, icon: Icon, label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
        active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

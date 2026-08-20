"use client";
import { ChevronDown, Sparkles, Workflow, Users, Building2, Target, TrendingUp, Flame, Gauge, PenLine, LayoutGrid, ArrowUpDown } from "lucide-react";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";

function TriggerButton({ icon: Icon, label, subtle }: { icon?: React.ElementType; label: string; subtle?: boolean }) {
  return (
    <button className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted ${subtle ? "border-input bg-card" : "border-primary/30 bg-primary/5 text-primary"}`}>
      {Icon && <Icon className="size-4" />} {label} <ChevronDown className="size-4 opacity-70" />
    </button>
  );
}

export function ResearchAIMenu({ onSelect }: { onSelect: (label: string) => void }) {
  const items = [
    { icon: Users, label: "Research selected leads" },
    { icon: Building2, label: "Research selected companies" },
    { icon: Target, label: "Find decision makers" },
    { icon: TrendingUp, label: "Find buying signals" },
    { icon: Flame, label: "Find hiring signals" },
    { icon: Gauge, label: "Analyze ICP fit" },
    { icon: PenLine, label: "Generate personalization" },
  ];
  return (
    <DropdownMenu trigger={<TriggerButton icon={Sparkles} label="Research with AI" />} className="w-60">
      {items.map((it) => (
        <DropdownItem key={it.label} onClick={() => onSelect(it.label)}><it.icon /> {it.label}</DropdownItem>
      ))}
    </DropdownMenu>
  );
}

export function CreateWorkflowMenu({ onSelect }: { onSelect: (label: string) => void }) {
  const items = ["Verify & enrich leads", "Find & verify emails", "Push to email sequence", "Sync to CRM", "Blank workflow"];
  return (
    <DropdownMenu trigger={<TriggerButton icon={Workflow} label="Create workflow" subtle />} className="w-56">
      {items.map((label) => <DropdownItem key={label} onClick={() => onSelect(label)}><Workflow /> {label}</DropdownItem>)}
    </DropdownMenu>
  );
}

export function DefaultViewMenu({ onSelect }: { onSelect: (label: string) => void }) {
  return (
    <DropdownMenu align="start" trigger={<TriggerButton icon={LayoutGrid} label="Default view" subtle />} className="w-48">
      <DropdownItem onClick={() => onSelect("Default view")}><LayoutGrid /> Default view</DropdownItem>
      <DropdownItem onClick={() => onSelect("Compact view")}><LayoutGrid /> Compact view</DropdownItem>
      <DropdownSeparator />
      <DropdownItem onClick={() => onSelect("Manage views")}>Manage views…</DropdownItem>
    </DropdownMenu>
  );
}

export function RelevanceMenu({ current, onSelect }: { current: string; onSelect: (value: string) => void }) {
  const opts: { value: string; label: string }[] = [
    { value: "relevance", label: "Relevance" },
    { value: "name", label: "Name A–Z" },
    { value: "company", label: "Company A–Z" },
    { value: "icpScore", label: "ICP score" },
  ];
  const label = opts.find((o) => o.value === current)?.label ?? "Relevance";
  return (
    <DropdownMenu trigger={<TriggerButton icon={ArrowUpDown} label={label} subtle />} className="w-44">
      {opts.map((o) => <DropdownItem key={o.value} onClick={() => onSelect(o.value)}>{o.label}</DropdownItem>)}
    </DropdownMenu>
  );
}

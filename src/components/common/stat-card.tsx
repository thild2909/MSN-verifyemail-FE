import { Card } from "@/components/ui/card";
import { cn, formatNumber } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: number | string;
  hint?: string;
  icon?: React.ElementType;
  accent?: "default" | "valid" | "invalid" | "risky" | "unknown";
  className?: string;
}

const ACCENT_CHIP: Record<NonNullable<StatCardProps["accent"]>, string> = {
  default: "bg-brand/10 text-brand",
  valid: "bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]",
  invalid: "bg-[hsl(var(--invalid)/0.12)] text-[hsl(var(--invalid))]",
  risky: "bg-[hsl(var(--risky)/0.12)] text-[hsl(var(--risky))]",
  unknown: "bg-surface text-muted-foreground",
};

const VALUE_COLOR: Record<NonNullable<StatCardProps["accent"]>, string> = {
  default: "text-brand",
  valid: "text-[hsl(var(--valid))]",
  invalid: "text-[hsl(var(--invalid))]",
  risky: "text-[hsl(var(--risky))]",
  unknown: "text-foreground",
};

/** KPI tile: label + tinted icon chip on top, a large coloured figure, and a muted hint. */
export function StatCard({ label, value, hint, icon: Icon, accent = "default", className }: StatCardProps) {
  return (
    <Card className={cn("p-4 sm:p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium leading-snug text-foreground/90">{label}</p>
        {Icon && (
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", ACCENT_CHIP[accent])}>
            <Icon className="size-4" strokeWidth={1.75} />
          </span>
        )}
      </div>
      <p className={cn("mt-3 text-2xl font-semibold tabular-nums tracking-tight sm:text-[1.65rem]", VALUE_COLOR[accent])}>
        {typeof value === "number" ? formatNumber(value) : value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

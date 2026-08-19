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

const ACCENT_BG: Record<NonNullable<StatCardProps["accent"]>, string> = {
  default: "bg-primary/10 text-primary",
  valid: "bg-valid/12 text-[hsl(var(--valid))]",
  invalid: "bg-invalid/12 text-[hsl(var(--invalid))]",
  risky: "bg-risky/12 text-[hsl(var(--risky))]",
  unknown: "bg-muted text-muted-foreground",
};

const VALUE_COLOR: Record<NonNullable<StatCardProps["accent"]>, string> = {
  default: "text-foreground",
  valid: "text-[hsl(var(--valid))]",
  invalid: "text-[hsl(var(--invalid))]",
  risky: "text-[hsl(var(--risky))]",
  unknown: "text-foreground",
};

export function StatCard({ label, value, hint, icon: Icon, accent = "default", className }: StatCardProps) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className={cn("mt-2 text-2xl font-bold tracking-tight", VALUE_COLOR[accent])}>
            {typeof value === "number" ? formatNumber(value) : value}
          </p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {Icon && (
          <div className={cn("flex size-10 items-center justify-center rounded-lg", ACCENT_BG[accent])}>
            <Icon className="size-5" />
          </div>
        )}
      </div>
    </Card>
  );
}

import { CheckCircle2, XCircle, AlertTriangle, HelpCircle, Trash2, Users, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { VerificationStatus } from "@/lib/types";

const CONFIG: Record<
  VerificationStatus,
  { label: string; variant: "success" | "destructive" | "warning" | "muted" | "default"; icon: React.ElementType }
> = {
  valid: { label: "Valid", variant: "success", icon: CheckCircle2 },
  invalid: { label: "Invalid", variant: "destructive", icon: XCircle },
  risky: { label: "Risky", variant: "warning", icon: AlertTriangle },
  unknown: { label: "Unknown", variant: "muted", icon: HelpCircle },
  disposable: { label: "Disposable", variant: "destructive", icon: Trash2 },
  role: { label: "Role", variant: "warning", icon: Users },
  catch_all: { label: "Catch-all", variant: "warning", icon: Globe },
};

export function StatusBadge({
  status,
  className,
  withIcon = true,
}: {
  status: VerificationStatus;
  className?: string;
  withIcon?: boolean;
}) {
  const c = CONFIG[status];
  const Icon = c.icon;
  return (
    <Badge variant={c.variant} className={cn(className)}>
      {withIcon && <Icon className="size-3" />}
      {c.label}
    </Badge>
  );
}

export function statusLabel(status: VerificationStatus) {
  return CONFIG[status].label;
}

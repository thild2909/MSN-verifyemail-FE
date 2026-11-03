import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-brand/[0.05] to-transparent" />
      <div className="relative mb-4 flex size-12 items-center justify-center rounded-xl border border-border bg-card text-brand shadow-xs">
        <Icon className="size-5" strokeWidth={1.75} />
      </div>
      <h3 className="relative text-[15px] font-semibold">{title}</h3>
      {description && <p className="relative mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="relative mt-5">{action}</div>}
    </div>
  );
}

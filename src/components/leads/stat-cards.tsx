import { colHeadMeta } from "@/components/common/col-head";
import { cn } from "@/lib/utils";

/** Compact stat tiles; each gets a meaning-coloured icon picked from its label. */
export function StatCards({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {items.map((s) => {
        const meta = colHeadMeta(s.label);
        const Glyph = meta?.icon;
        return (
          <div key={s.label} className="flex min-w-[140px] flex-1 items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 shadow-xs">
            {Glyph && (
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface">
                <Glyph className={cn("size-4", meta?.tone)} strokeWidth={1.75} />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">{s.label}</p>
              <p className="text-lg font-semibold tracking-tight tabular-nums text-foreground">{s.value}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

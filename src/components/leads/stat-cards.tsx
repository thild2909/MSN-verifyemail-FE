export function StatCards({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {items.map((s) => (
        <div key={s.label} className="min-w-[120px] flex-1 rounded-lg border bg-card px-4 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{s.label}</p>
          <p className="mt-0.5 text-xl font-bold tracking-tight tabular-nums">{s.value}</p>
        </div>
      ))}
    </div>
  );
}

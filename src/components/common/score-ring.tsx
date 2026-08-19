import { cn } from "@/lib/utils";

export function ScoreRing({
  score,
  size = 72,
  className,
  tone = "hsl(var(--primary))",
}: {
  score: number;
  size?: number;
  className?: string;
  tone?: string;
}) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold leading-none">{score}</span>
        <span className="text-[10px] text-muted-foreground">score</span>
      </div>
    </div>
  );
}

export function scoreTone(score: number): string {
  if (score >= 80) return "hsl(var(--valid))";
  if (score >= 55) return "hsl(var(--risky))";
  return "hsl(var(--invalid))";
}

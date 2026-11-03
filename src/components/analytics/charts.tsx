"use client";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  AreaChart, Area, LineChart, Line,
} from "recharts";
import type { AnalyticsPoint } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

/*
 * Colours are CSS tokens, so every chart re-themes with light/dark on its own.
 * valid/risky/invalid/unknown are STATUS colours (reserved meaning) and always
 * ship with a legend + tooltip + table view, never colour alone. Stack order
 * valid → unknown → risky → invalid keeps the CVD-weak green/orange pair apart.
 */
export const SERIES = [
  { key: "valid", label: "Valid", color: "hsl(var(--valid))" },
  { key: "unknown", label: "Unknown", color: "hsl(var(--unknown))" },
  { key: "risky", label: "Risky", color: "hsl(var(--risky))" },
  { key: "invalid", label: "Invalid", color: "hsl(var(--invalid))" },
] as const;
export type SeriesKey = (typeof SERIES)[number]["key"];

const BRAND = "hsl(var(--brand))";
const SURFACE = "hsl(var(--card))";
const GRID = "hsl(var(--border))";

const axisProps = {
  stroke: "hsl(var(--muted-foreground))",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

export function shortDate(d: string) {
  // d is a calendar day (YYYY-MM-DD) — parse as local noon so no tz shift.
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function longDate(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function ChartTooltip({ active, payload, label, showTotal }: any) {
  if (!active || !payload?.length) return null;
  const rows = [...payload].reverse(); // top of stack first
  const total = payload.reduce((n: number, p: any) => n + (Number(p.value) || 0), 0);
  return (
    <div className="min-w-[11rem] rounded-xl border border-border bg-popover p-3 text-xs shadow-pop">
      <p className="mb-2 font-semibold text-foreground">{longDate(label)}</p>
      <div className="space-y-1">
        {rows.map((p: any) => (
          <div key={p.dataKey} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: p.color || p.fill || p.stroke }} />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="ml-auto font-semibold tabular-nums text-foreground">{formatNumber(Number(p.value) || 0)}</span>
          </div>
        ))}
      </div>
      {showTotal && rows.length > 1 && (
        <div className="mt-2 flex items-center border-t border-border pt-2">
          <span className="text-muted-foreground">Total</span>
          <span className="ml-auto font-semibold tabular-nums text-foreground">{formatNumber(total)}</span>
        </div>
      )}
    </div>
  );
}

/** Stacked daily verification volume by result bucket. */
export function VolumeChart({ data, height = 300 }: { data: AnalyticsPoint[]; height?: number }) {
  const dense = data.length > 40;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }} barCategoryGap={dense ? "12%" : "28%"}>
        <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 4" />
        <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={28} />
        <YAxis {...axisProps} allowDecimals={false} width={44} tickFormatter={(v) => formatNumber(v)} />
        <Tooltip content={<ChartTooltip showTotal />} cursor={{ fill: "hsl(var(--surface))" }} />
        {SERIES.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId="v"
            fill={s.color}
            // 2px surface gap between stacked segments.
            stroke={SURFACE}
            strokeWidth={dense ? 1 : 2}
            radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Daily credits spent (from the credit ledger). Single series → no legend. */
export function CreditsChart({ data, height = 220 }: { data: AnalyticsPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="creditFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity={0.22} />
            <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 4" />
        <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={28} />
        <YAxis {...axisProps} allowDecimals={false} width={44} tickFormatter={(v) => formatNumber(v)} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }} />
        <Area
          type="monotone"
          dataKey="credits"
          name="Credits spent"
          stroke={BRAND}
          strokeWidth={2}
          fill="url(#creditFill)"
          activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2, fill: BRAND }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Valid vs invalid trend (dashboard). */
export function TrendChart({ data }: { data: AnalyticsPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 4" />
        <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={28} />
        <YAxis {...axisProps} allowDecimals={false} width={44} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }} />
        <Line type="monotone" dataKey="valid" name="Valid" stroke="hsl(var(--valid))" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }} />
        <Line type="monotone" dataKey="invalid" name="Invalid" stroke="hsl(var(--invalid))" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

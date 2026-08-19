"use client";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  AreaChart, Area, LineChart, Line,
} from "recharts";
import type { AnalyticsPoint } from "@/lib/types";

const COLORS = {
  valid: "hsl(142 71% 45%)",
  invalid: "hsl(0 72% 51%)",
  risky: "hsl(38 92% 50%)",
  unknown: "hsl(220 9% 55%)",
  primary: "hsl(243 75% 59%)",
};

const axisProps = {
  stroke: "hsl(220 9% 60%)",
  fontSize: 12,
  tickLine: false,
  axisLine: false,
};

function shortDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card p-3 text-xs shadow-lg">
      <p className="mb-1.5 font-medium">{shortDate(label)}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="capitalize text-muted-foreground">{p.dataKey}</span>
          <span className="ml-auto font-medium">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export function VolumeChart({ data }: { data: AnalyticsPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(220 13% 91%)" />
        <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "hsl(220 14% 96%)" }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Bar dataKey="valid" stackId="a" fill={COLORS.valid} radius={[0, 0, 0, 0]} />
        <Bar dataKey="risky" stackId="a" fill={COLORS.risky} />
        <Bar dataKey="unknown" stackId="a" fill={COLORS.unknown} />
        <Bar dataKey="invalid" stackId="a" fill={COLORS.invalid} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CreditsChart({ data }: { data: AnalyticsPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="creditFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.3} />
            <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(220 13% 91%)" />
        <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} />
        <Tooltip content={<ChartTooltip />} />
        <Area type="monotone" dataKey="credits" stroke={COLORS.primary} strokeWidth={2} fill="url(#creditFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function TrendChart({ data }: { data: AnalyticsPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(220 13% 91%)" />
        <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} />
        <Tooltip content={<ChartTooltip />} />
        <Line type="monotone" dataKey="valid" stroke={COLORS.valid} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="invalid" stroke={COLORS.invalid} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

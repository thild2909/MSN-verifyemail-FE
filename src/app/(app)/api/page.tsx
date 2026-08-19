"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Activity, Key, BookOpen, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getApiKeys, getBackendHealth } from "@/lib/api/client";
import { formatNumber } from "@/lib/utils";

const ENDPOINTS = [
  { method: "POST", path: "/api/v1/verify", desc: "Verify a single email" },
  { method: "POST", path: "/api/v1/verify/bulk", desc: "Submit a bulk verification job" },
  { method: "GET", path: "/api/v1/verification/{id}", desc: "Fetch a verification result" },
  { method: "GET", path: "/api/v1/lists", desc: "List your uploaded lists" },
  { method: "POST", path: "/api/v1/finder", desc: "Find professional emails" },
  { method: "GET", path: "/api/v1/usage", desc: "Credit usage summary" },
];

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-valid/12 text-[hsl(var(--valid))]",
  POST: "bg-primary/10 text-primary",
};

export default function ApiPage() {
  const { data: keys } = useQuery({ queryKey: ["apiKeys"], queryFn: getApiKeys });
  const { data: health } = useQuery({
    queryKey: ["backendHealth"],
    queryFn: getBackendHealth,
    refetchInterval: 15_000,
  });
  const active = keys?.filter((k) => k.status === "active") ?? [];
  const totalRequests = keys?.reduce((a, k) => a + k.requests, 0) ?? 0;
  const online = health?.online ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="API"
        subtitle="Integrate verification directly into your product."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/api/docs" className={buttonVariants({ variant: "outline" })}><BookOpen className="size-4" /> Docs</Link>
            <Link href="/api/keys" className={buttonVariants()}><Key className="size-4" /> Manage keys</Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Verification backend</p>
              <p className="mt-2 flex items-center gap-2 text-xl font-bold">
                <span className={`size-2.5 rounded-full ${online ? "bg-[hsl(var(--valid))]" : "bg-[hsl(var(--invalid))]"}`} />
                {online ? "Online" : "Offline"}
              </p>
              {health?.url && <p className="mt-1 truncate text-xs text-muted-foreground">{health.url}</p>}
            </div>
            <Activity className={`size-5 ${online ? "text-[hsl(var(--valid))]" : "text-muted-foreground"}`} />
          </div>
        </Card>
        <StatCard label="Active keys" value={active.length} icon={Key} />
        <StatCard label="Total requests" value={totalRequests} icon={Activity} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Endpoints</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {ENDPOINTS.map((e) => (
            <div key={e.path} className="flex items-center gap-3 rounded-lg border p-3">
              <span className={`w-14 rounded-md px-2 py-0.5 text-center text-xs font-bold ${METHOD_COLORS[e.method]}`}>{e.method}</span>
              <code className="font-mono text-sm">{e.path}</code>
              <span className="ml-auto hidden text-sm text-muted-foreground sm:block">{e.desc}</span>
            </div>
          ))}
          <Link href="/api/docs" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            Read the full documentation <ArrowRight className="size-4" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

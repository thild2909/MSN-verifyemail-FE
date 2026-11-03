"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Activity, Key, BookOpen, ArrowRight, Server, Webhook, Terminal, ChevronRight, Plug } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { IconTile, Pill, SectionCard, type Tone } from "@/components/common/kit";
import { getApiKeys, getBackendHealth } from "@/lib/api/client";
import { cn, formatNumber } from "@/lib/utils";

const ENDPOINTS = [
  { method: "POST", path: "/api/v1/verify", desc: "Verify a single email" },
  { method: "POST", path: "/api/v1/verify/bulk", desc: "Submit a bulk verification job" },
  { method: "GET", path: "/api/v1/verification/{id}", desc: "Fetch a verification result" },
  { method: "GET", path: "/api/v1/lists", desc: "List your uploaded lists" },
  { method: "POST", path: "/api/v1/finder", desc: "Find professional emails" },
  { method: "GET", path: "/api/v1/usage", desc: "Credit usage summary" },
];

const METHOD_TONE: Record<string, Tone> = { GET: "valid", POST: "brand" };

const SNIPPET = `curl -X POST /api/v1/verify \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "email": "john@example.com" }'`;

export default function ApiPage() {
  const { data: keys } = useQuery({ queryKey: ["apiKeys"], queryFn: getApiKeys });
  const { data: health } = useQuery({ queryKey: ["backendHealth"], queryFn: getBackendHealth, refetchInterval: 15_000 });
  const active = keys?.filter((k) => k.status === "active") ?? [];
  const totalRequests = keys?.reduce((a, k) => a + k.requests, 0) ?? 0;
  const online = health?.online ?? false;

  const stats: { label: string; value: React.ReactNode; icon: React.ElementType; tone: Tone; sub?: string }[] = [
    {
      label: "Verification backend",
      value: (
        <span className={cn("inline-flex items-center gap-1.5", online ? "text-[hsl(var(--valid))]" : "text-[hsl(var(--invalid))]")}>
          <span className={cn("size-2 rounded-full", online ? "bg-[hsl(var(--valid))]" : "bg-[hsl(var(--invalid))]")} />
          {health ? (online ? "Online" : "Offline") : "Checking…"}
        </span>
      ),
      icon: Server,
      tone: online ? "valid" : "invalid",
      sub: health?.url || undefined,
    },
    { label: "Active keys", value: formatNumber(active.length), icon: Key, tone: "brand", sub: `${formatNumber(keys?.length ?? 0)} total` },
    { label: "Total requests", value: formatNumber(totalRequests), icon: Activity, tone: "sky", sub: "All keys, all time" },
    { label: "Endpoints", value: ENDPOINTS.length, icon: Plug, tone: "violet", sub: "REST · JSON" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="API"
        subtitle="Integrate verification directly into your product."
        actions={
          <>
            <Link href="/api/docs" className={buttonVariants({ variant: "outline" })}><BookOpen /> Docs</Link>
            <Link href="/api/keys" className={buttonVariants()}><Key /> Manage keys</Link>
          </>
        }
      />

      {/* Summary strip */}
      <Card className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        {stats.map((s) => (
          <div key={s.label} className="flex min-w-0 items-center gap-3 px-4 py-3.5 sm:px-5">
            <IconTile icon={s.icon} tone={s.tone} className="rounded-full" />
            <div className="min-w-0">
              <p className="truncate text-[13px] text-muted-foreground">{s.label}</p>
              <p className="truncate text-[15px] font-semibold tabular-nums">{s.value}</p>
              {s.sub && <p className="truncate text-[11px] text-muted-foreground">{s.sub}</p>}
            </div>
          </div>
        ))}
      </Card>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Endpoints */}
        <SectionCard
          className="lg:col-span-3"
          icon={Plug}
          tone="violet"
          title="Endpoints"
          description="Core REST resources, authenticated with a Bearer key."
          aside={<Link href="/api/docs" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">Full reference <ArrowRight className="size-3.5" /></Link>}
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border">
            {ENDPOINTS.map((e) => (
              <li key={e.path} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface/60 sm:px-5">
                <Pill tone={METHOD_TONE[e.method]} className="w-12 justify-center font-mono uppercase">{e.method}</Pill>
                <div className="min-w-0 flex-1">
                  <code className="block truncate font-mono text-[13px]">{e.path}</code>
                  <p className="truncate text-xs text-muted-foreground sm:hidden">{e.desc}</p>
                </div>
                <span className="hidden text-sm text-muted-foreground sm:block">{e.desc}</span>
              </li>
            ))}
          </ul>
        </SectionCard>

        {/* Quick start */}
        <div className="space-y-5 lg:col-span-2">
          <SectionCard icon={Terminal} tone="sky" title="Quick start" description="Verify your first email in one request.">
            <pre className="scrollbar-thin overflow-x-auto rounded-lg border border-border bg-[hsl(229_22%_9%)] p-3.5 text-[11px] leading-relaxed text-[hsl(225_20%_88%)]">
              <code>{SNIPPET}</code>
            </pre>
          </SectionCard>

          <Card className="divide-y divide-border overflow-hidden">
            {[
              { href: "/api/keys", icon: Key, tone: "brand" as Tone, title: "API keys", desc: "Create, rotate and revoke keys" },
              { href: "/api/keys", icon: Webhook, tone: "risky" as Tone, title: "Webhooks", desc: "Signed events with retries" },
              { href: "/api/docs", icon: BookOpen, tone: "valid" as Tone, title: "Documentation", desc: "Requests, responses and errors" },
            ].map((l) => (
              <Link key={l.title} href={l.href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface/60 sm:px-5">
                <IconTile icon={l.icon} tone={l.tone} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{l.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{l.desc}</p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { KeyRound, Mail, Layers, AlertTriangle, Gauge, BookOpen, Hash, Code2, Timer, Zap } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { buttonVariants } from "@/components/ui/button";
import { IconTile, Pill, SectionCard, type Tone } from "@/components/common/kit";
import { ColHead } from "@/components/common/col-head";
import { CodeBlock } from "@/components/api/code-block";

export const metadata = { title: "API Docs" };

const SECTIONS: { id: string; label: string; icon: React.ElementType; tone: Tone }[] = [
  { id: "auth", label: "Authentication", icon: KeyRound, tone: "brand" },
  { id: "verify", label: "Verify an email", icon: Mail, tone: "valid" },
  { id: "bulk", label: "Bulk verification", icon: Layers, tone: "violet" },
  { id: "errors", label: "Errors", icon: AlertTriangle, tone: "invalid" },
  { id: "limits", label: "Rate limits", icon: Gauge, tone: "risky" },
];

const ERRORS: [string, string, string][] = [
  ["INSUFFICIENT_CREDITS", "402", "Not enough credits for the requested operation."],
  ["INVALID_REQUEST", "400", "The request body failed validation."],
  ["UNAUTHORIZED", "401", "Missing or invalid API key."],
  ["RATE_LIMITED", "429", "Too many requests. Slow down."],
  ["NOT_FOUND", "404", "The requested resource does not exist."],
];

function Endpoint({ method, path }: { method: "GET" | "POST"; path: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface/60 px-2.5 py-1.5">
      <Pill tone={method === "GET" ? "valid" : "brand"} className="font-mono uppercase">{method}</Pill>
      <code className="min-w-0 truncate font-mono text-[13px]">{path}</code>
    </div>
  );
}

function Params({ rows }: { rows: [string, string, boolean, string][] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-[13px] text-muted-foreground">
            <th className="px-3 py-2 font-normal"><ColHead label="Field" icon={Hash} /></th>
            <th className="px-3 py-2 font-normal"><ColHead label="Type" icon={Code2} /></th>
            <th className="hidden px-3 py-2 font-normal sm:table-cell"><ColHead label="Description" /></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, type, required, desc]) => (
            <tr key={name} className="border-b border-border/60 last:border-0">
              <td className="px-3 py-2 align-top">
                <code className="font-mono text-[13px] font-medium">{name}</code>
                {required && <span className="ml-1.5 rounded bg-[hsl(var(--invalid)/0.1)] px-1 text-[10px] font-semibold text-[hsl(var(--invalid))]">required</span>}
                <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">{desc}</p>
              </td>
              <td className="px-3 py-2 align-top"><code className="font-mono text-xs text-muted-foreground">{type}</code></td>
              <td className="hidden px-3 py-2 align-top text-muted-foreground sm:table-cell">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ApiDocsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/api"
        title="API documentation"
        subtitle="Everything you need to verify emails programmatically."
        actions={<Link href="/api/keys" className={buttonVariants()}><KeyRound /> Get an API key</Link>}
      />

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* TOC */}
        <nav aria-label="On this page" className="hidden lg:block">
          <div className="sticky top-[5.5rem] rounded-xl border border-border bg-card p-2 shadow-card">
            <p className="flex items-center gap-1.5 px-2 pb-1.5 pt-1 text-xs font-medium text-muted-foreground">
              <BookOpen className="size-3.5" /> On this page
            </p>
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-surface">
                <IconTile icon={s.icon} tone={s.tone} size="sm" />
                {s.label}
              </a>
            ))}
          </div>
        </nav>

        <div className="min-w-0 space-y-6">
          {/* Mobile TOC */}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar lg:hidden">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm">
                <s.icon className="size-4 text-muted-foreground" strokeWidth={1.75} /> {s.label}
              </a>
            ))}
          </div>

          <SectionCard id="auth" icon={KeyRound} tone="brand" title="Authentication" description="Pass your secret key as a Bearer token. Never expose keys in client-side code.">
            <CodeBlock
              lang="bash"
              title="cURL"
              code={`curl -X POST "$BASE_URL/api/v1/verify" \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "email": "john@example.com" }'`}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              <code className="rounded bg-surface px-1 font-mono">$BASE_URL</code> is the address of your Mind Supernova workspace. Create and revoke keys under{" "}
              <Link href="/api/keys" className="font-medium text-brand hover:underline">API keys</Link>.
            </p>
          </SectionCard>

          <SectionCard id="verify" icon={Mail} tone="valid" title="Verify an email" description="Check a single address in real time." aside={<Endpoint method="POST" path="/api/v1/verify" />}>
            <div className="space-y-4">
              <Params rows={[
                ["email", "string", true, "The address to verify."],
                ["deep_scan", "boolean", false, "Run the deeper SMTP probe (costs more credits)."],
              ]} />
              <div className="grid gap-4 xl:grid-cols-2">
                <CodeBlock title="Request" code={`{
  "email": "john@example.com",
  "deep_scan": true
}`} />
                <CodeBlock title="Response · 200" code={`{
  "success": true,
  "data": {
    "email": "john@example.com",
    "status": "valid",
    "score": 96,
    "checks": {
      "syntax": true,
      "mx": true,
      "smtp": true,
      "catch_all": false,
      "disposable": false,
      "role_based": false
    }
  }
}`} />
              </div>
            </div>
          </SectionCard>

          <SectionCard id="bulk" icon={Layers} tone="violet" title="Bulk verification" description="Queue many addresses as one job; get notified by webhook." aside={<Endpoint method="POST" path="/api/v1/verify/bulk" />}>
            <div className="space-y-4">
              <Params rows={[
                ["emails", "string[]", true, "Addresses to verify in this job."],
                ["webhook_url", "string", false, "Called when the job finishes."],
              ]} />
              <div className="grid gap-4 xl:grid-cols-2">
                <CodeBlock title="Request" code={`{
  "emails": [
    "john@example.com",
    "sarah@globex.io"
  ],
  "webhook_url": "https://you.com/hook"
}`} />
                <CodeBlock title="Response · 202 Accepted" code={`{
  "success": true,
  "data": {
    "job_id": "job_9f2a",
    "status": "queued",
    "count": 2
  }
}`} />
              </div>
            </div>
          </SectionCard>

          <SectionCard id="errors" icon={AlertTriangle} tone="invalid" title="Errors" description="Every error uses the same envelope with a stable code." bodyClassName="p-0">
            <div className="p-4 sm:p-5">
              <CodeBlock title="Error body" code={`{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "Not enough credits to perform this verification."
  }
}`} />
            </div>
            <table className="w-full border-t border-border text-sm">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-[13px] text-muted-foreground">
                  <th className="px-4 py-2.5 font-normal sm:pl-5"><ColHead label="Code" icon={Code2} /></th>
                  <th className="px-4 py-2.5 font-normal"><ColHead label="HTTP" icon={Hash} /></th>
                  <th className="hidden px-4 py-2.5 font-normal sm:table-cell sm:pr-5"><ColHead label="Meaning" /></th>
                </tr>
              </thead>
              <tbody>
                {ERRORS.map(([code, http, desc]) => (
                  <tr key={code} className="border-b border-border/60 last:border-0 hover:bg-surface/60">
                    <td className="px-4 py-2.5 align-top sm:pl-5">
                      <code className="font-mono text-[13px] font-medium text-brand">{code}</code>
                      <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">{desc}</p>
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <span className="rounded-md bg-[hsl(var(--invalid)/0.1)] px-1.5 py-0.5 font-mono text-xs font-semibold text-[hsl(var(--invalid))]">{http}</span>
                    </td>
                    <td className="hidden px-4 py-2.5 align-top text-muted-foreground sm:table-cell sm:pr-5">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>

          <SectionCard id="limits" icon={Gauge} tone="risky" title="Rate limits" description="Limits apply per API key.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-3 rounded-xl border border-border p-3.5">
                <IconTile icon={Zap} tone="brand" className="rounded-full" />
                <div>
                  <p className="text-lg font-semibold tabular-nums">100 <span className="text-sm font-normal text-muted-foreground">req / second</span></p>
                  <p className="text-xs text-muted-foreground">Single verification</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border p-3.5">
                <IconTile icon={Layers} tone="violet" className="rounded-full" />
                <div>
                  <p className="text-lg font-semibold tabular-nums">10 <span className="text-sm font-normal text-muted-foreground">concurrent jobs</span></p>
                  <p className="text-xs text-muted-foreground">Bulk verification</p>
                </div>
              </div>
            </div>
            <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
              <Timer className="mt-px size-3.5 shrink-0" />
              Every response includes <code className="rounded bg-surface px-1 font-mono">X-RateLimit-Remaining</code> and{" "}
              <code className="rounded bg-surface px-1 font-mono">X-RateLimit-Reset</code> headers.
            </p>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

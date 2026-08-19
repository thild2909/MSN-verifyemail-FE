import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "API Docs" };

function Code({ children }: { children: string }) {
  return (
    <pre className="scrollbar-thin overflow-x-auto rounded-lg bg-sidebar p-4 text-xs leading-relaxed text-sidebar-foreground">
      <code>{children}</code>
    </pre>
  );
}

const ERRORS = [
  ["INSUFFICIENT_CREDITS", "402", "Not enough credits for the requested operation."],
  ["INVALID_REQUEST", "400", "The request body failed validation."],
  ["UNAUTHORIZED", "401", "Missing or invalid API key."],
  ["RATE_LIMITED", "429", "Too many requests — slow down."],
  ["NOT_FOUND", "404", "The requested resource does not exist."],
];

export default function ApiDocsPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/api" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> API
        </Link>
        <PageHeader title="API Documentation" subtitle="Everything you need to verify emails programmatically." />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Authentication</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Pass your secret key as a Bearer token. Never expose keys in client-side code.</p>
          <Code>{`curl https://api.verifly.dev/api/v1/verify \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{ "email": "john@example.com" }'`}</Code>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Badge>POST</Badge> /api/v1/verify</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium">Request</p>
            <Code>{`{
  "email": "john@example.com",
  "deep_scan": true
}`}</Code>
            <p className="text-sm font-medium">Response</p>
            <Code>{`{
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
}`}</Code>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Badge>POST</Badge> /api/v1/verify/bulk</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium">Request</p>
            <Code>{`{
  "emails": [
    "john@example.com",
    "sarah@globex.io"
  ],
  "webhook_url": "https://you.com/hook"
}`}</Code>
            <p className="text-sm font-medium">Response (202 Accepted)</p>
            <Code>{`{
  "success": true,
  "data": {
    "job_id": "job_9f2a",
    "status": "queued",
    "count": 2
  }
}`}</Code>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Error format &amp; codes</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Code>{`{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "Not enough credits to perform this verification."
  }
}`}</Code>
          <div className="divide-y">
            {ERRORS.map(([code, http, desc]) => (
              <div key={code} className="flex items-center gap-4 py-2.5 text-sm">
                <code className="w-52 shrink-0 font-mono text-primary">{code}</code>
                <span className="w-10 shrink-0 tabular-nums text-muted-foreground">{http}</span>
                <span className="text-muted-foreground">{desc}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Rate limits</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>Default: <span className="font-medium text-foreground">100 requests / second</span> per key for single verification, and 10 concurrent bulk jobs.
          Every response includes <code className="font-mono">X-RateLimit-Remaining</code> and <code className="font-mono">X-RateLimit-Reset</code> headers.</p>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";
import * as React from "react";
import Papa from "papaparse";
import {
  FileText, CheckCircle2, Loader2, X, ArrowRight, Download, Search, ShieldCheck, Copy,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileDropzone } from "@/components/verification/file-dropzone";
import { StatusBadge } from "@/components/verification/status-badge";
import { verifyEmail } from "@/lib/api/client";
import { formatNumber, seededRandom, cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import type { VerificationStatus } from "@/lib/types";

type Step = "idle" | "mapping" | "finding" | "done";

interface Parsed {
  fileName: string;
  columns: string[];
  rows: string[][];
  simulated: boolean;
}

interface FoundRow {
  id: string;
  name: string;
  domain: string;
  email: string;
  confidence: number;
  pattern: string;
  status: VerificationStatus | "unverified";
  verifying?: boolean;
}

const FIRST_RE = /first|fname|given/i;
const LAST_RE = /last|lname|surname|family/i;
const DOMAIN_RE = /domain|company|organi|website|employer|account/i;
const MAX_VERIFY = 200;

/** Turn a company/domain cell into a best-guess domain. */
function toDomain(value: string): string {
  const s = value.trim().toLowerCase();
  if (!s) return "";
  const d = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (d.includes(".") && !d.includes(" ")) return d;
  const slug = s
    .replace(/\b(inc|llc|ltd|corp|co|gmbh|group|company)\b/gi, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
  return slug ? `${slug}.com` : "";
}

export function BulkFinderPanel() {
  const [step, setStep] = React.useState<Step>("idle");
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [map, setMap] = React.useState({ first: "", last: "", domain: "" });
  const [rows, setRows] = React.useState<FoundRow[]>([]);
  const [progress, setProgress] = React.useState(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const { toast } = useToast();

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStep("idle");
    setParsed(null);
    setRows([]);
    setProgress(0);
  };

  const onFile = (file: File) => {
    const finish = (columns: string[], data: string[][], simulated: boolean) => {
      const cols = columns.length ? columns : ["first_name", "last_name", "company"];
      setParsed({ fileName: file.name, columns: cols, rows: data, simulated });
      setMap({
        first: cols.find((c) => FIRST_RE.test(c)) ?? cols[0] ?? "",
        last: cols.find((c) => LAST_RE.test(c)) ?? cols[1] ?? "",
        domain: cols.find((c) => DOMAIN_RE.test(c)) ?? cols[2] ?? "",
      });
      setStep("mapping");
    };

    if (file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
      Papa.parse(file, {
        skipEmptyLines: true,
        complete: (res) => {
          const data = res.data as string[][];
          if (!data.length) return simulateFile(file, finish);
          const header = data[0].map((h) => String(h).trim());
          const looksLikeHeader = header.some((h) => FIRST_RE.test(h) || LAST_RE.test(h) || DOMAIN_RE.test(h));
          if (looksLikeHeader) finish(header, data.slice(1), false);
          else finish(["first_name", "last_name", "company"], data, false);
        },
        error: () => simulateFile(file, finish),
      });
    } else {
      simulateFile(file, finish);
    }
  };

  const findEmails = () => {
    if (!parsed) return;
    setStep("finding");
    const fi = parsed.columns.indexOf(map.first);
    const li = parsed.columns.indexOf(map.last);
    const di = parsed.columns.indexOf(map.domain);

    const found: FoundRow[] = [];
    for (let i = 0; i < parsed.rows.length; i++) {
      const r = parsed.rows[i];
      const first = (r[fi] ?? "").trim();
      const last = (r[li] ?? "").trim();
      const domain = toDomain(r[di] ?? "");
      if ((!first && !last) || !domain) continue;
      const local = first && last ? `${first}.${last}`.toLowerCase() : (first || last).toLowerCase();
      const email = `${local.replace(/[^a-z0-9._-]/g, "")}@${domain}`;
      const conf = 78 + Math.round(seededRandom(email) * 18); // 78–96
      found.push({
        id: `bf_${i}`,
        name: [first, last].filter(Boolean).join(" ") || domain,
        domain,
        email,
        confidence: conf,
        pattern: first && last ? "{first}.{last}" : "{name}",
        status: "unverified",
      });
    }

    // brief animated progress for feedback, then reveal results
    let p = 0;
    const tick = () => {
      p = Math.min(100, p + 12);
      setProgress(p);
      if (p < 100) setTimeout(tick, 60);
      else {
        setRows(found);
        setStep("done");
        toast({
          variant: "success",
          title: "Emails discovered",
          description: `${formatNumber(found.length)} contacts from ${formatNumber(parsed.rows.length)} rows.`,
        });
      }
    };
    setTimeout(tick, 100);
  };

  const verifyAll = async () => {
    const targets = rows.slice(0, MAX_VERIFY);
    const controller = new AbortController();
    abortRef.current = controller;
    let next = 0;
    const worker = async () => {
      while (next < targets.length) {
        if (controller.signal.aborted) return;
        const row = targets[next++];
        setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, verifying: true } : x)));
        try {
          const { result } = await verifyEmail(row.email);
          setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, status: result.status, verifying: false } : x)));
        } catch {
          setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, verifying: false } : x)));
        }
      }
    };
    toast({ variant: "info", title: "Verifying discovered emails…" });
    await Promise.all(Array.from({ length: 6 }, () => worker()));
    if (!controller.signal.aborted) toast({ variant: "success", title: "Verification finished" });
    abortRef.current = null;
  };

  const verifyRow = async (row: FoundRow) => {
    setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, verifying: true } : x)));
    try {
      const { result } = await verifyEmail(row.email);
      setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, status: result.status, verifying: false } : x)));
    } catch {
      setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, verifying: false } : x)));
    }
  };

  const exportCsv = () => {
    const header = "name,email,domain,confidence,status\n";
    const body = rows
      .map((r) => `"${r.name}",${r.email},${r.domain},${r.confidence},${r.status}`)
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "found-emails.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast({ variant: "success", title: "Exported CSV", description: `${rows.length} contacts.` });
  };

  /* -------------------------------- render -------------------------------- */

  if (step === "idle") {
    return (
      <div className="space-y-3">
        <FileDropzone onFile={onFile} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Upload a list of people (first name, last name, company/domain) to find their business emails.</span>
          <button onClick={downloadExample} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            <Download className="size-3.5" /> Download example CSV
          </button>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="size-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">{parsed?.fileName}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(parsed?.rows.length ?? 0)} rows detected</p>
            </div>
          </div>
          {step !== "finding" && (
            <button onClick={reset} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Cancel">
              <X className="size-4" />
            </button>
          )}
        </div>

        {step === "mapping" && parsed && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-valid/10 px-3 py-2 text-sm text-[hsl(var(--valid))]">
              <CheckCircle2 className="size-4" /> File parsed — map the columns below.
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="First name">
                <Select value={map.first} onChange={(e) => setMap({ ...map, first: e.target.value })}>
                  <option value="">—</option>
                  {parsed.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="Last name">
                <Select value={map.last} onChange={(e) => setMap({ ...map, last: e.target.value })}>
                  <option value="">—</option>
                  {parsed.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="Company / domain">
                <Select value={map.domain} onChange={(e) => setMap({ ...map, domain: e.target.value })}>
                  <option value="">—</option>
                  {parsed.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
            </div>
            <Button className="w-full" disabled={!map.domain || (!map.first && !map.last)} onClick={findEmails}>
              <Search className="size-4" /> Find emails <ArrowRight className="size-4" />
            </Button>
          </div>
        )}

        {step === "finding" && (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin text-primary" /> Discovering emails…
            </div>
            <Progress value={progress} />
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{formatNumber(rows.length)} emails discovered</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={verifyAll}>
                  <ShieldCheck className="size-4" /> Verify all
                </Button>
                <Button size="sm" variant="outline" onClick={exportCsv}>
                  <Download className="size-4" /> Export CSV
                </Button>
                <Button size="sm" variant="ghost" onClick={reset}>New file</Button>
              </div>
            </div>

            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.domain}</TableCell>
                      <TableCell className="font-medium">{r.email}</TableCell>
                      <TableCell><ConfidenceBar value={r.confidence} /></TableCell>
                      <TableCell>
                        {r.status === "unverified"
                          ? <span className="text-xs text-muted-foreground">Unverified</span>
                          : <StatusBadge status={r.status} />}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Copy"
                            onClick={() => {
                              navigator.clipboard?.writeText(r.email);
                              toast({ variant: "success", title: "Copied", description: r.email });
                            }}
                          >
                            <Copy className="size-4" />
                          </Button>
                          <Button size="sm" variant="ghost" disabled={r.verifying} onClick={() => verifyRow(r)}>
                            {r.verifying ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Verify
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------- helpers -------------------------------- */

function ConfidenceBar({ value }: { value: number }) {
  const tone = value >= 85 ? "bg-[hsl(var(--valid))]" : value >= 60 ? "bg-[hsl(var(--risky))]" : "bg-muted-foreground";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-sm font-medium tabular-nums">{value}%</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function simulateFile(file: File, finish: (cols: string[], rows: string[][], simulated: boolean) => void) {
  const est = Math.max(20, Math.round(file.size / 60));
  const rows = Array.from({ length: est }, (_, i) => [`First${i}`, `Last${i}`, "example.com"]);
  finish(["first_name", "last_name", "company"], rows, true);
}

function downloadExample() {
  const csv =
    "first_name,last_name,company\n" +
    "John,Smith,acme.com\n" +
    "Sarah,Lee,globex.io\n" +
    "David,Wong,Initech Inc\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "people-example.csv";
  a.click();
  URL.revokeObjectURL(url);
}

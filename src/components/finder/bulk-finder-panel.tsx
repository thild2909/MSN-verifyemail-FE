"use client";
import * as React from "react";
import Papa from "papaparse";
import {
  FileText, CheckCircle2, Loader2, X, ArrowRight, Download, Search, Copy, Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileDropzone } from "@/components/verification/file-dropzone";
import { findEmailsBulk, verifyEmail } from "@/lib/api/client";
import { FINDER_STATE_META, scoreIsMeaningful } from "@/lib/finder/state-ui";
import { formatNumber, cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import type { BulkFinderResponse, FinderState, VerificationStatus } from "@/lib/types";

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
  score: number;
  status: VerificationStatus | "unverified";
  state: FinderState;
}

const FIRST_RE = /first|fname|given/i;
const LAST_RE = /last|lname|surname|family/i;
const DOMAIN_RE = /domain|company|organi|website|employer|account/i;
/** Matches the server's per-request cap (FINDER_BULK_MAX). */
const MAX_FIND = 100;

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
  const [stats, setStats] = React.useState<BulkFinderResponse["stats"] | null>(null);
  const [verifyingIds, setVerifyingIds] = React.useState<Set<string>>(new Set());
  const { toast } = useToast();

  const reset = () => {
    setStep("idle");
    setParsed(null);
    setRows([]);
    setStats(null);
    setVerifyingIds(new Set());
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

  const findEmails = async () => {
    if (!parsed) return;
    setStep("finding");
    const fi = parsed.columns.indexOf(map.first);
    const li = parsed.columns.indexOf(map.last);
    const di = parsed.columns.indexOf(map.domain);

    // The finder needs first + last + domain per person.
    const people: { firstName: string; lastName: string; domain: string }[] = [];
    const names: string[] = [];
    let skippedRows = 0;
    for (const r of parsed.rows) {
      const first = (r[fi] ?? "").trim();
      const last = (r[li] ?? "").trim();
      const domain = toDomain(r[di] ?? "");
      if (!first || !last || !domain) {
        skippedRows++;
        continue;
      }
      people.push({ firstName: first, lastName: last, domain });
      names.push(`${first} ${last}`);
    }

    const capped = people.slice(0, MAX_FIND);
    const overflow = people.length - capped.length;
    if (capped.length === 0) {
      toast({ variant: "warning", title: "No usable rows", description: "Each row needs first name, last name and a company/domain." });
      setStep("mapping");
      return;
    }

    try {
      const { results, stats } = await findEmailsBulk(capped);
      const found: FoundRow[] = results.map((res, i) => ({
        id: `bf_${i}`,
        name: names[i],
        domain: res.outcome.result.domain,
        email: res.outcome.result.email,
        score: res.outcome.result.score,
        status: res.outcome.result.status,
        state: res.outcome.state,
      }));
      setRows(found);
      setStats(stats);
      setStep("done");
      const notes = [
        skippedRows ? `${formatNumber(skippedRows)} row(s) skipped` : "",
        overflow ? `${formatNumber(overflow)} over the ${MAX_FIND} cap` : "",
      ].filter(Boolean).join(" · ");
      toast({
        variant: "success",
        title: "Emails found",
        description: `${formatNumber(found.length)} people · ${stats.backendCalls} live checks (saved ${stats.saved})${notes ? ` · ${notes}` : ""}.`,
      });
    } catch {
      toast({ variant: "error", title: "Bulk find failed", description: "Please try again." });
      setStep("mapping");
    }
  };

  /** Manual live re-check of one row (bypasses cache on the single-verify path). */
  const verifyRow = async (row: FoundRow) => {
    setVerifyingIds((s) => new Set(s).add(row.id));
    try {
      const { result } = await verifyEmail(row.email);
      // Mirror the server's verdict rule so the state chip stays consistent.
      const state: FinderState =
        result.status === "valid"
          ? "verified"
          : result.status !== "invalid" && result.score >= 60
            ? "accept_all"
            : "not_found";
      setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, status: result.status, score: result.score, state } : x)));
    } catch {
      /* leave the row unchanged on error */
    } finally {
      setVerifyingIds((s) => {
        const n = new Set(s);
        n.delete(row.id);
        return n;
      });
    }
  };

  const exportCsv = () => {
    const header = "name,email,domain,score,status,state\n";
    const body = rows
      .map((r) => `"${r.name}",${r.email},${r.domain},${r.score},${r.status},${r.state}`)
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
          <div className="flex items-center gap-2 py-6 text-sm font-medium">
            <Loader2 className="size-4 animate-spin text-primary" />
            Finding &amp; verifying emails — one shared pass over the backend…
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {formatNumber(rows.filter((r) => scoreIsMeaningful(r.state)).length)} found
                <span className="text-muted-foreground">
                  {" · "}
                  {formatNumber(rows.filter((r) => !scoreIsMeaningful(r.state)).length)} not found
                </span>
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={exportCsv}>
                  <Download className="size-4" /> Export CSV
                </Button>
                <Button size="sm" variant="ghost" onClick={reset}>New file</Button>
              </div>
            </div>

            {stats && (
              <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
                <Zap className="size-4 shrink-0" />
                {formatNumber(stats.backendCalls)} live checks for {formatNumber(stats.people)} people — saved{" "}
                {formatNumber(stats.saved)} of {formatNumber(stats.naiveCalls)} thanks to early-exit + shared domain/email cache.
              </div>
            )}

            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.domain}</TableCell>
                      <TableCell className={cn("font-medium", !scoreIsMeaningful(r.state) && "text-muted-foreground")}>{r.email}</TableCell>
                      <TableCell>
                        {scoreIsMeaningful(r.state)
                          ? <ScoreBar value={r.score} />
                          : <span className="text-sm text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", FINDER_STATE_META[r.state].className)}>
                          {React.createElement(FINDER_STATE_META[r.state].icon, { className: "size-3" })}
                          {FINDER_STATE_META[r.state].chip}
                        </span>
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
                          <Button size="sm" variant="ghost" disabled={verifyingIds.has(r.id)} onClick={() => verifyRow(r)}>
                            {verifyingIds.has(r.id) ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Verify
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

function ScoreBar({ value }: { value: number }) {
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

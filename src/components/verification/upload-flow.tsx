"use client";
import * as React from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { FileText, CheckCircle2, AlertTriangle, Loader2, X, ArrowRight, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FileDropzone } from "./file-dropzone";
import { createList, getList, type CreateListContact } from "@/lib/api/client";
import { formatNumber } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import type { EmailList } from "@/lib/types";

type Step = "idle" | "parsed" | "ready" | "processing" | "done";

interface Parsed {
  fileName: string;
  columns: string[]; // ALL original columns, preserved as-is
  rows: string[][]; // ALL original data rows
  emailColumn: string; // auto-detected email column
  totalRows: number;
  skipped: number; // rows dropped because the email cell was empty
  uniqueEmails: number;
  duplicates: number;
}

const EMAIL_LIKE = /email|e-mail|mail|address/i;
const FIRST_RE = /first|fname|given/i;
const LAST_RE = /last|lname|surname|family/i;
const COMPANY_RE = /company|organi|employer|account/i;
const TITLE_RE = /title|role|position|job/i;

export function UploadFlow() {
  const [step, setStep] = React.useState<Step>("idle");
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [list, setList] = React.useState<EmailList | null>(null);
  const [creating, setCreating] = React.useState(false);
  const pollRef = React.useRef(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const router = useRouter();

  const reset = () => {
    pollRef.current = false;
    setStep("idle");
    setParsed(null);
    setList(null);
    setCreating(false);
  };

  React.useEffect(() => () => { pollRef.current = false; }, []);

  /* ------------------------------ parsing ------------------------------ */

  const applyRows = (file: File, columns: string[], rows: string[][]) => {
    const cols = columns.length ? columns : ["email"];
    // Validation: the file MUST contain an email column. No fallback to column 0 —
    // if none of the headers look like an email column, refuse the import.
    const emailCol = cols.find((c) => EMAIL_LIKE.test(c));
    if (!emailCol) {
      toast({
        variant: "error",
        title: "No email column found",
        description: "The file must include an email column to import.",
      });
      return;
    }

    const idx = cols.indexOf(emailCol);
    const emails = rows.map((r) => (r[idx] ?? "").trim().toLowerCase());
    const present = emails.filter(Boolean); // rows that actually have an email
    const skipped = emails.length - present.length; // rows dropped for a missing email
    const unique = new Set(present);

    if (unique.size === 0) {
      toast({
        variant: "error",
        title: "No valid emails",
        description: "Every row is missing an email address in this file.",
      });
      return;
    }

    // Column-level sanity: a real email column must contain email-like values.
    // Guards headerless files whose first column is not actually emails.
    if (!present.some((e) => e.includes("@"))) {
      toast({
        variant: "error",
        title: "No email column found",
        description: "The file must include an email column to import.",
      });
      return;
    }

    // Keep ALL original columns + rows; only rows with an empty email are skipped
    // later (buildContacts), never any column.
    setParsed({
      fileName: file.name,
      columns: cols,
      rows,
      emailColumn: emailCol,
      totalRows: rows.length,
      skipped,
      uniqueEmails: unique.size,
      duplicates: Math.max(0, present.length - unique.size),
    });
    setStep("parsed");
  };

  const onFile = async (file: File) => {
    try {
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const { columns, rows } = await parseXlsx(file);
        if (!rows.length) return toast({ variant: "error", title: "No rows found in file" });
        applyRows(file, columns, rows);
      } else {
        Papa.parse(file, {
          skipEmptyLines: true,
          complete: (res) => {
            const data = (res.data as string[][]).filter((r) => r.some((c) => String(c).trim()));
            if (!data.length) return toast({ variant: "error", title: "Empty file" });
            const header = data[0].map((h) => String(h).trim());
            const looksLikeHeader = header.some((h) => EMAIL_LIKE.test(h) || FIRST_RE.test(h) || COMPANY_RE.test(h));
            if (looksLikeHeader) applyRows(file, header, data.slice(1));
            else applyRows(file, ["email"], data);
          },
          error: () => toast({ variant: "error", title: "Could not parse file" }),
        });
      }
    } catch {
      toast({ variant: "error", title: "Could not read file" });
    }
  };

  /* ---------------------------- start (BE) ----------------------------- */

  const buildContacts = (p: Parsed): CreateListContact[] => {
    const find = (re: RegExp) => p.columns.findIndex((c) => re.test(c));
    const eIdx = p.columns.indexOf(p.emailColumn);
    const fIdx = find(FIRST_RE), lIdx = find(LAST_RE), cIdx = find(COMPANY_RE), tIdx = find(TITLE_RE);
    const out: CreateListContact[] = [];
    for (const r of p.rows) {
      const email = (r[eIdx] ?? "").trim().toLowerCase();
      if (!email) continue; // skip rows with a missing email (reported as `skipped`)

      // Preserve EVERY original column (except the email itself) so no field from
      // the source file is lost — stored on the record as `custom`.
      const custom: Record<string, string> = {};
      p.columns.forEach((col, i) => {
        if (i === eIdx) return;
        const v = (r[i] ?? "").trim();
        if (v) custom[col] = v;
      });

      out.push({
        email,
        firstName: fIdx >= 0 ? r[fIdx]?.trim() || undefined : undefined,
        lastName: lIdx >= 0 ? r[lIdx]?.trim() || undefined : undefined,
        company: cIdx >= 0 ? r[cIdx]?.trim() || undefined : undefined,
        jobTitle: tIdx >= 0 ? r[tIdx]?.trim() || undefined : undefined,
        custom: Object.keys(custom).length ? custom : undefined,
      });
    }
    return out;
  };

  const start = async () => {
    if (!parsed) return;
    setCreating(true);
    try {
      const { list: created, truncated } = await createList({
        name: parsed.fileName.replace(/\.[^.]+$/, ""),
        fileName: parsed.fileName,
        columns: parsed.columns,
        emailColumn: parsed.emailColumn,
        contacts: buildContacts(parsed),
      });
      setList(created);
      setStep("processing");
      qc.invalidateQueries({ queryKey: ["lists"] });
      if (truncated > 0) {
        toast({ variant: "info", title: "List capped for this session", description: `${formatNumber(truncated)} extra emails were not queued.` });
      }
      poll(created.id);
    } catch {
      toast({ variant: "error", title: "Could not start verification" });
    } finally {
      setCreating(false);
    }
  };

  const poll = (id: string) => {
    pollRef.current = true;
    const tick = async () => {
      if (!pollRef.current) return;
      try {
        const l = await getList(id);
        if (l) {
          setList(l);
          if (l.status === "completed" || l.status === "failed") {
            pollRef.current = false;
            setStep("done");
            qc.invalidateQueries({ queryKey: ["credits"] });
            qc.invalidateQueries({ queryKey: ["lists"] });
            toast({ variant: "success", title: "Verification completed", description: `${formatNumber(l.summary.total)} emails processed.` });
            return;
          }
        }
      } catch {
        /* keep polling */
      }
      setTimeout(tick, 1500);
    };
    setTimeout(tick, 1200);
  };

  /* ------------------------------ derived ------------------------------ */

  const summary = list?.summary;
  const verified = summary ? summary.valid + summary.invalid + summary.risky + summary.unknown : 0;
  const progress = list?.progress ?? 0;

  /* ------------------------------ render ------------------------------- */

  if (step === "idle") {
    return (
      <div className="space-y-3">
        <FileDropzone onFile={onFile} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Auto-detects the email column · dedupes · verified on the server via SMTP + MX.</span>
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
              <p className="text-xs text-muted-foreground">{formatNumber(parsed?.totalRows ?? 0)} rows detected</p>
            </div>
          </div>
          {step !== "processing" && (
            <button onClick={reset} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Cancel">
              <X className="size-4" />
            </button>
          )}
        </div>

        {step === "parsed" && parsed && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-valid/10 px-3 py-2 text-sm text-[hsl(var(--valid))]">
              <CheckCircle2 className="size-4" /> Parsed — {formatNumber(parsed.uniqueEmails)} unique emails
            </div>
            {parsed.skipped > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-risky/10 px-3 py-2 text-sm text-[hsl(var(--risky))]">
                <AlertTriangle className="size-4" />
                {formatNumber(parsed.skipped)} {parsed.skipped === 1 ? "row" : "rows"} skipped — missing email
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Uploaded" value={parsed.totalRows} />
              <Stat label="Duplicates" value={parsed.duplicates} />
              <Stat label="Unique emails" value={parsed.uniqueEmails} highlight />
            </div>
            <p className="text-xs text-muted-foreground">
              Email column auto-detected: <span className="font-medium text-foreground">{parsed.emailColumn}</span>
              {" · "}all {parsed.columns.length} columns preserved
            </p>
            <Button className="w-full" onClick={() => setStep("ready")}>
              Continue <ArrowRight className="size-4" />
            </Button>
          </div>
        )}

        {step === "ready" && parsed && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <Row label="Unique emails" value={formatNumber(parsed.uniqueEmails)} strong />
            </div>
            <p className="rounded-lg bg-accent/50 px-3 py-2 text-xs text-accent-foreground">
              Verification runs on the server — you can leave this page and check the list later.
            </p>
            <Button className="w-full" disabled={creating} onClick={start}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : "Start verification"}
            </Button>
          </div>
        )}

        {(step === "processing" || step === "done") && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium">
                {step === "processing" ? (
                  <><Loader2 className="size-4 animate-spin text-primary" /> Verifying on server…</>
                ) : (
                  <><CheckCircle2 className="size-4 text-[hsl(var(--valid))]" /> Verification complete</>
                )}
              </span>
              <span className="text-muted-foreground">{progress}%</span>
            </div>
            <Progress value={progress} indicatorClassName={step === "done" ? "bg-[hsl(var(--valid))]" : ""} />
            <p className="text-xs text-muted-foreground">
              {formatNumber(verified)} / {formatNumber(list?.uniqueEmails ?? 0)} verified · live SMTP checks
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Valid" value={summary?.valid ?? 0} tone="text-[hsl(var(--valid))]" />
              <MiniStat label="Invalid" value={summary?.invalid ?? 0} tone="text-[hsl(var(--invalid))]" />
              <MiniStat label="Risky" value={summary?.risky ?? 0} tone="text-[hsl(var(--risky))]" />
              <MiniStat label="Unknown" value={summary?.unknown ?? 0} tone="text-muted-foreground" />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => list && router.push(`/verification/lists/${list.id}`)}>
                {step === "done" ? "View results" : "Open list"}
              </Button>
              {step === "done" && <Button variant="outline" onClick={reset}>Verify another</Button>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------- helpers ------------------------------ */

async function parseXlsx(file: File): Promise<{ columns: string[]; rows: string[][] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: false });
  const rows = aoa
    .map((r) => (r as unknown[]).map((c) => (c == null ? "" : String(c))))
    .filter((r) => r.some((c) => c.trim()));
  if (!rows.length) return { columns: ["email"], rows: [] };
  const header = rows[0].map((h) => h.trim());
  const looksLikeHeader = header.some((h) => EMAIL_LIKE.test(h) || FIRST_RE.test(h) || COMPANY_RE.test(h));
  return looksLikeHeader ? { columns: header, rows: rows.slice(1) } : { columns: ["email"], rows };
}

function downloadExample() {
  const csv =
    "email,first_name,last_name,company,job_title\n" +
    "john.smith@acme.com,John,Smith,Acme Corp,CEO\n" +
    "sarah.lee@globex.io,Sarah,Lee,Globex,CTO\n" +
    "info@initech.com,,,Initech,\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "example-list.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-bold ${highlight ? "text-primary" : ""}`}>{formatNumber(value)}</p>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${tone}`}>{formatNumber(value)}</p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-bold text-primary" : "font-medium"}>{value}</span>
    </div>
  );
}

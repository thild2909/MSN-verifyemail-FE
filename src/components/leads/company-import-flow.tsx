"use client";
import * as React from "react";
import Papa from "papaparse";
import { CheckCircle2, ArrowRight, Loader2, Download, AlertTriangle, Building2, FileSpreadsheet, ListChecks, Check } from "lucide-react";
import { IconTile, Field } from "@/components/common/kit";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FileDropzone } from "@/components/verification/file-dropzone";
import { useToast } from "@/components/ui/toast";
import { createCollectJob, matchLeadItems, ApiError, type LeadItem } from "@/lib/api/client";
import type { CollectedCompany } from "@/lib/leads/collect-types";
import { formatNumber, cn } from "@/lib/utils";

interface Parsed { fileName: string; columns: string[]; rows: string[][] }
const COMPANY_RE = /company|organi|account|business|name/i;
const LOCATION_RE = /location|city|country|region|address|hq|state/i;

/**
 * Pick the best-fitting column for a role. Among columns whose name matches
 * `re`, choose the one with the most non-empty cells (so a populated `City`
 * beats a mostly-blank `State`); ties keep left-to-right order. `exclude` skips
 * a column already claimed by another role. Returns undefined if none match.
 */
function bestColumn(cols: string[], rows: string[][], re: RegExp, exclude?: string): string | undefined {
  let best: string | undefined;
  let bestFill = -1;
  cols.forEach((c, i) => {
    if (c === exclude || !re.test(c)) return;
    let fill = 0;
    for (const r of rows) if ((r[i] ?? "").trim()) fill++;
    if (fill > bestFill) { bestFill = fill; best = c; }
  });
  return best;
}

export function CompanyImportFlow({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (jobId: string) => void }) {
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [name, setName] = React.useState("");
  const [map, setMap] = React.useState({ company: "", location: "" });
  const [creating, setCreating] = React.useState(false);
  // Rows already saved in a list (import dedup), keyed by built-row index → snapshot.
  const [matches, setMatches] = React.useState<Record<string, LeadItem>>({});
  const [matching, setMatching] = React.useState(false);
  const { toast } = useToast();

  const reset = () => { setParsed(null); setName(""); setMap({ company: "", location: "" }); setCreating(false); setMatches({}); };
  const close = () => { onOpenChange(false); setTimeout(reset, 200); };

  const onFile = (file: File) => {
    const finish = (columns: string[], data: string[][]) => {
      const cols = columns.length ? columns : ["company", "location"];
      setParsed({ fileName: file.name, columns: cols, rows: data });
      // Auto-pick the DENSEST column whose name matches, not just the first name
      // match — e.g. a file with both `State` (sparse) and `City` (populated)
      // must map location to `City`, else rows with a blank `State` get dropped.
      const company = bestColumn(cols, data, COMPANY_RE) ?? cols[0] ?? "";
      const location = bestColumn(cols, data, LOCATION_RE, company) ?? cols.find((c) => c !== company) ?? "";
      setMap({ company, location });
      setName(file.name.replace(/\.[^.]+$/, ""));
    };
    const fail = (message = "Use a .csv or .xlsx with Company Name and Location columns.") =>
      toast({ variant: "error", title: "Could not read file", description: message });
    // Turn a raw array-of-rows into columns + data, detecting whether the first
    // row is a header. Shared by the CSV and XLSX paths.
    const ingest = (rows: string[][]) => {
      if (!rows.length) return fail("The file is empty.");
      const header = rows[0].map((h) => String(h).trim());
      const looks = header.some((h) => COMPANY_RE.test(h) || LOCATION_RE.test(h));
      looks ? finish(header, rows.slice(1)) : finish(["company", "location"], rows);
    };

    const lower = file.name.toLowerCase();
    if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
      Papa.parse(file, {
        skipEmptyLines: true,
        complete: (res) => ingest(res.data as string[][]),
        error: () => fail(),
      });
    } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      file.arrayBuffer()
        .then(async (buf) => {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          if (!ws) return fail("No sheet found in the workbook.");
          const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "" });
          ingest(aoa.map((r) => (Array.isArray(r) ? r : []).map((c) => (c == null ? "" : String(c)))));
        })
        .catch(() => fail());
    } else fail("Unsupported file type. Upload a .csv or .xlsx file.");
  };

  const built = React.useMemo(() => {
    if (!parsed) return [] as { company: string; location: string }[];
    const ci = parsed.columns.indexOf(map.company), li = parsed.columns.indexOf(map.location);
    const out: { company: string; location: string }[] = [];
    for (const r of parsed.rows) {
      const company = (r[ci] ?? "").trim(), location = (r[li] ?? "").trim();
      if (company && location) out.push({ company, location });
    }
    return out;
  }, [parsed, map]);

  // Cross-reference the built rows against every saved list. A hit means the
  // company is already enriched somewhere, so we reuse that snapshot (no crawl).
  React.useEffect(() => {
    setMatches({}); // drop stale hits before re-matching — indices shift when the mapping changes
    if (built.length === 0) return;
    let cancelled = false;
    setMatching(true);
    matchLeadItems({ companies: built.map((r, i) => ({ key: String(i), company: r.company, location: r.location })) })
      .then((res) => { if (!cancelled) setMatches(res.companies); })
      .catch(() => { if (!cancelled) setMatches({}); })
      .finally(() => { if (!cancelled) setMatching(false); });
    return () => { cancelled = true; };
  }, [built]);

  const matchedCount = React.useMemo(() => built.reduce((n, _r, i) => (matches[String(i)] ? n + 1 : n), 0), [built, matches]);

  const skipped = parsed ? parsed.rows.length - built.length : 0;

  const create = async () => {
    if (!parsed || built.length === 0) return;
    setCreating(true);
    try {
      const rows = built.map((r, i) => ({ ...r, prefill: (matches[String(i)]?.data as unknown as CollectedCompany | undefined) ?? null }));
      const { job, truncated } = await createCollectJob({ name: name.trim() || parsed.fileName, fileName: parsed.fileName, rows });
      toast({ variant: "success", title: "Collection started", description: `${formatNumber(job.total)} companies${truncated ? ` · ${formatNumber(truncated)} over cap` : ""}.` });
      onCreated(job.id);
      close();
    } catch (err) {
      toast({ variant: "error", title: err instanceof ApiError && err.code === "MISSING_FIELDS" ? "Company Name & Location required" : "Could not start", description: "Please check the file and try again." });
      setCreating(false);
    }
  };

  const step = parsed ? 2 : 1;

  return (
    <Dialog open={open} onOpenChange={close} className="max-w-xl">
      <DialogHeader>
        <div className="mb-3 flex items-center justify-between gap-3">
          <IconTile icon={Building2} tone="brand" />
          <StepIndicator step={step} />
        </div>
        <DialogTitle>Import companies</DialogTitle>
        <DialogDescription>Upload a CSV with <span className="font-medium text-foreground">Company Name</span> and <span className="font-medium text-foreground">Location</span> (both required). We collect the rest from multiple sources.</DialogDescription>
      </DialogHeader>

      {!parsed ? (
        <div className="space-y-3">
          <FileDropzone onFile={onFile} />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Needs two columns: company name + location.</span>
            <button onClick={downloadExample} className="inline-flex shrink-0 items-center gap-1 font-medium text-brand hover:underline"><Download className="size-3.5" /> Download example CSV</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface/60 p-2.5">
            <IconTile icon={FileSpreadsheet} tone="valid" size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{parsed.fileName}</p>
              <p className="text-[11px] text-muted-foreground"><span className="tabular-nums">{formatNumber(parsed.rows.length)}</span> rows · <span className="tabular-nums">{parsed.columns.length}</span> columns · map the required columns</p>
            </div>
            <CheckCircle2 className="size-4 shrink-0 text-[hsl(var(--valid))]" strokeWidth={1.75} />
          </div>
          <Field label="Job name" htmlFor="company-import-name">
            <Input id="company-import-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Target accounts" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={<>Company Name <span className="text-[hsl(var(--invalid))]">*</span></>}>
              <Select value={map.company} onChange={(e) => setMap({ ...map, company: e.target.value })}><option value="">—</option>{parsed.columns.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
            </Field>
            <Field label={<>Location <span className="text-[hsl(var(--invalid))]">*</span></>}>
              <Select value={map.location} onChange={(e) => setMap({ ...map, location: e.target.value })}><option value="">—</option>{parsed.columns.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><ListChecks className="size-3.5 text-[hsl(var(--valid))]" strokeWidth={1.75} /><span className="font-semibold tabular-nums text-foreground">{formatNumber(built.length)}</span> valid rows</span>
            {skipped > 0 && <span className="inline-flex items-center gap-1 rounded-md bg-[hsl(var(--risky)/0.14)] px-1.5 py-0.5 font-medium text-[hsl(var(--risky))]"><AlertTriangle className="size-3.5" /> <span className="tabular-nums">{formatNumber(skipped)}</span> rows missing name/location</span>}
          </div>
          {matching && <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-brand animate-pulse" /> Checking your lists for matches…</p>}
          {matchedCount > 0 && (
            <p className="rounded-lg border border-brand/20 bg-brand/[0.06] px-3 py-2 text-xs text-brand">
              <span className="font-semibold tabular-nums">{formatNumber(matchedCount)}</span> compan{matchedCount === 1 ? "y is" : "ies are"} already in your <span className="font-semibold">Lists</span>. Filled straight from the saved record, <span className="font-semibold">no crawl</span>.
            </p>
          )}
        </div>
      )}

      <DialogFooter>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button disabled={!parsed || built.length === 0 || !map.company || !map.location || creating} onClick={create}>
          {creating ? <Loader2 className="animate-spin" /> : null} Collect {built.length > 0 ? formatNumber(built.length) : ""} companies <ArrowRight />
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** "Upload → Map & collect" step dots: brand for current, valid for done. */
function StepIndicator({ step }: { step: 1 | 2 }) {
  const steps = ["Upload", "Map & collect"];
  return (
    <ol className="flex items-center gap-1.5">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <li key={label} className="flex items-center gap-1.5">
            {i > 0 && <span className={cn("h-px w-4", done || current ? "bg-[hsl(var(--valid)/0.5)]" : "bg-border")} />}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                current ? "bg-brand/10 text-brand" : done ? "bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]" : "bg-surface text-muted-foreground",
              )}
            >
              <span className={cn("flex size-4 items-center justify-center rounded-full text-[10px] tabular-nums", current ? "bg-card text-brand ring-1 ring-brand/40" : done ? "bg-card text-[hsl(var(--valid))] ring-1 ring-[hsl(var(--valid)/0.4)]" : "bg-card text-muted-foreground ring-1 ring-border")}>
                {done ? <Check className="size-2.5" strokeWidth={3} /> : n}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function downloadExample() {
  const csv = "company,location\nSolara Health,Sydney Australia\nFinTech Labs,Melbourne Australia\nNorthwind,Berlin Germany\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "companies-location-example.csv"; a.click();
  URL.revokeObjectURL(url);
}

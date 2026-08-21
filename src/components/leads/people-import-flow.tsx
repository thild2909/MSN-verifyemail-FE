"use client";
import * as React from "react";
import Papa from "papaparse";
import { CheckCircle2, ArrowRight, Loader2, Download, AlertTriangle } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { FileDropzone } from "@/components/verification/file-dropzone";
import { useToast } from "@/components/ui/toast";
import { createPeopleJob, ApiError } from "@/lib/api/client";
import { formatNumber } from "@/lib/utils";

interface Parsed { fileName: string; columns: string[]; rows: string[][] }
const FIRST_RE = /first.?name|given|fname|^first$/i;
const LAST_RE = /last.?name|surname|family|lname|^last$/i;
const COMPANY_RE = /company|organi|account|business|employer|^org$/i;
const LOCATION_RE = /location|city|country|region|address|hq|state/i;
const FULLNAME_RE = /full.?name|^name$|contact/i;

/** Densest column whose header matches `re` (populated beats sparse); `exclude` skips claimed columns. */
function bestColumn(cols: string[], rows: string[][], re: RegExp, exclude: string[] = []): string | undefined {
  let best: string | undefined;
  let bestFill = -1;
  cols.forEach((c, i) => {
    if (exclude.includes(c) || !re.test(c)) return;
    let fill = 0;
    for (const r of rows) if ((r[i] ?? "").trim()) fill++;
    if (fill > bestFill) { bestFill = fill; best = c; }
  });
  return best;
}

export function PeopleImportFlow({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (jobId: string) => void }) {
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [name, setName] = React.useState("");
  const [map, setMap] = React.useState({ firstName: "", lastName: "", company: "", location: "" });
  const [creating, setCreating] = React.useState(false);
  const { toast } = useToast();

  const reset = () => { setParsed(null); setName(""); setMap({ firstName: "", lastName: "", company: "", location: "" }); setCreating(false); };
  const close = () => { onOpenChange(false); setTimeout(reset, 200); };

  const onFile = (file: File) => {
    const finish = (columns: string[], data: string[][]) => {
      const cols = columns.length ? columns : ["first_name", "last_name", "company", "location"];
      setParsed({ fileName: file.name, columns: cols, rows: data });
      const firstName = bestColumn(cols, data, FIRST_RE) ?? bestColumn(cols, data, FULLNAME_RE) ?? cols[0] ?? "";
      const lastName = bestColumn(cols, data, LAST_RE, [firstName]) ?? cols.find((c) => c !== firstName) ?? "";
      const company = bestColumn(cols, data, COMPANY_RE, [firstName, lastName]) ?? "";
      const location = bestColumn(cols, data, LOCATION_RE, [firstName, lastName, company]) ?? "";
      setMap({ firstName, lastName, company, location });
      setName(file.name.replace(/\.[^.]+$/, ""));
    };
    const fail = (message = "Use a .csv or .xlsx with First Name, Last Name and Company Name columns.") =>
      toast({ variant: "error", title: "Could not read file", description: message });
    const ingest = (rows: string[][]) => {
      if (!rows.length) return fail("The file is empty.");
      const header = rows[0].map((h) => String(h).trim());
      const looks = header.some((h) => FIRST_RE.test(h) || LAST_RE.test(h) || COMPANY_RE.test(h) || FULLNAME_RE.test(h));
      looks ? finish(header, rows.slice(1)) : finish(["first_name", "last_name", "company", "location"], rows);
    };

    const lower = file.name.toLowerCase();
    if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
      Papa.parse(file, { skipEmptyLines: true, complete: (res) => ingest(res.data as string[][]), error: () => fail() });
    } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      file.arrayBuffer().then(async (buf) => {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) return fail("No sheet found in the workbook.");
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "" });
        ingest(aoa.map((r) => (Array.isArray(r) ? r : []).map((c) => (c == null ? "" : String(c)))));
      }).catch(() => fail());
    } else fail("Unsupported file type. Upload a .csv or .xlsx file.");
  };

  const built = React.useMemo(() => {
    if (!parsed) return [] as { firstName: string; lastName: string; company: string; location: string }[];
    const fi = parsed.columns.indexOf(map.firstName), lastI = parsed.columns.indexOf(map.lastName);
    const ci = parsed.columns.indexOf(map.company), locI = parsed.columns.indexOf(map.location);
    const out: { firstName: string; lastName: string; company: string; location: string }[] = [];
    for (const r of parsed.rows) {
      let firstName = (r[fi] ?? "").trim();
      let lastName = lastI >= 0 ? (r[lastI] ?? "").trim() : "";
      const company = (r[ci] ?? "").trim();
      const location = locI >= 0 ? (r[locI] ?? "").trim() : "";
      // If only a single Full Name column was mapped to First Name, split it.
      if (map.firstName === map.lastName || (!lastName && /\s/.test(firstName) && FULLNAME_RE.test(map.firstName))) {
        const parts = firstName.split(/\s+/);
        firstName = parts[0]; lastName = parts.slice(1).join(" ");
      }
      if (firstName && lastName && company) out.push({ firstName, lastName, company, location });
    }
    return out;
  }, [parsed, map]);

  const skipped = parsed ? parsed.rows.length - built.length : 0;

  const create = async () => {
    if (!parsed || built.length === 0) return;
    setCreating(true);
    try {
      const { job, truncated } = await createPeopleJob({
        name: name.trim() || parsed.fileName,
        seeds: built.map((r) => ({ firstName: r.firstName, lastName: r.lastName, company: r.company, location: r.location })),
      });
      toast({ variant: "success", title: "Finding people…", description: `Enriching ${formatNumber(job.totalCompanies)} people${truncated ? ` · ${formatNumber(truncated)} over cap` : ""}.` });
      onCreated(job.id);
      close();
    } catch (err) {
      toast({ variant: "error", title: err instanceof ApiError ? "Could not start" : "Could not start", description: "First Name, Last Name & Company Name are required. Check the file and try again." });
      setCreating(false);
    }
  };

  const missingMap = !map.firstName || !map.lastName || !map.company;

  return (
    <Dialog open={open} onOpenChange={close} className="max-w-xl">
      <DialogHeader>
        <DialogTitle>Import people</DialogTitle>
        <DialogDescription>
          Upload a CSV with <span className="font-medium text-foreground">First Name</span>, <span className="font-medium text-foreground">Last Name</span> and <span className="font-medium text-foreground">Company Name</span> (all required). We find each person's LinkedIn, title and a verifiable work email.
        </DialogDescription>
      </DialogHeader>

      {!parsed ? (
        <div className="space-y-3">
          <FileDropzone onFile={onFile} />
          <button onClick={downloadExample} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><Download className="size-3.5" /> Download example CSV</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg bg-valid/10 px-3 py-2 text-sm text-[hsl(var(--valid))]"><CheckCircle2 className="size-4" /> {parsed.fileName} — map the required columns.</div>
          <div className="space-y-1.5"><Label>Job name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Target contacts" /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MapField label="First Name" required value={map.firstName} cols={parsed.columns} onChange={(v) => setMap({ ...map, firstName: v })} />
            <MapField label="Last Name" required value={map.lastName} cols={parsed.columns} onChange={(v) => setMap({ ...map, lastName: v })} />
            <MapField label="Company Name" required value={map.company} cols={parsed.columns} onChange={(v) => setMap({ ...map, company: v })} />
            <MapField label="Location" value={map.location} cols={parsed.columns} onChange={(v) => setMap({ ...map, location: v })} />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span><span className="font-semibold text-foreground">{formatNumber(built.length)}</span> valid rows</span>
            {skipped > 0 && <span className="inline-flex items-center gap-1 text-[hsl(var(--risky))]"><AlertTriangle className="size-3.5" /> {formatNumber(skipped)} rows missing first/last/company</span>}
          </div>
        </div>
      )}

      <DialogFooter>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button disabled={!parsed || built.length === 0 || missingMap || creating} onClick={create}>
          {creating ? <Loader2 className="size-4 animate-spin" /> : null} Find {built.length > 0 ? formatNumber(built.length) : ""} people <ArrowRight className="size-4" />
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function MapField({ label, required, value, cols, onChange }: { label: string; required?: boolean; value: string; cols: string[]; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label} {required && <span className="text-[hsl(var(--invalid))]">*</span>}</Label>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {cols.map((c) => <option key={c} value={c}>{c}</option>)}
      </Select>
    </div>
  );
}

function downloadExample() {
  const csv = "first_name,last_name,company,location\nAnthony,Tan,Grab,Singapore\nShirley,Koh,Talentsis,Singapore\nForrest,Li,Sea,Singapore\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "people-import-example.csv"; a.click();
  URL.revokeObjectURL(url);
}

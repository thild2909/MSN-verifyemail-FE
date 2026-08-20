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
import { createCollectJob, ApiError } from "@/lib/api/client";
import { formatNumber } from "@/lib/utils";

interface Parsed { fileName: string; columns: string[]; rows: string[][] }
const COMPANY_RE = /company|organi|account|business|name/i;
const LOCATION_RE = /location|city|country|region|address|hq|state/i;

export function CompanyImportFlow({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (jobId: string) => void }) {
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [name, setName] = React.useState("");
  const [map, setMap] = React.useState({ company: "", location: "" });
  const [creating, setCreating] = React.useState(false);
  const { toast } = useToast();

  const reset = () => { setParsed(null); setName(""); setMap({ company: "", location: "" }); setCreating(false); };
  const close = () => { onOpenChange(false); setTimeout(reset, 200); };

  const onFile = (file: File) => {
    const finish = (columns: string[], data: string[][]) => {
      const cols = columns.length ? columns : ["company", "location"];
      setParsed({ fileName: file.name, columns: cols, rows: data });
      setMap({ company: cols.find((c) => COMPANY_RE.test(c)) ?? cols[0] ?? "", location: cols.find((c) => LOCATION_RE.test(c)) ?? cols[1] ?? "" });
      setName(file.name.replace(/\.[^.]+$/, ""));
    };
    if (file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
      Papa.parse(file, { skipEmptyLines: true, complete: (res) => {
        const data = res.data as string[][];
        if (!data.length) return finish(["company", "location"], sample());
        const header = data[0].map((h) => String(h).trim());
        const looks = header.some((h) => COMPANY_RE.test(h) || LOCATION_RE.test(h));
        looks ? finish(header, data.slice(1)) : finish(["company", "location"], data);
      }, error: () => finish(["company", "location"], sample()) });
    } else finish(["company", "location"], sample());
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

  const skipped = parsed ? parsed.rows.length - built.length : 0;

  const create = async () => {
    if (!parsed || built.length === 0) return;
    setCreating(true);
    try {
      const { job, truncated } = await createCollectJob({ name: name.trim() || parsed.fileName, fileName: parsed.fileName, rows: built });
      toast({ variant: "success", title: "Collection started", description: `${formatNumber(job.total)} companies${truncated ? ` · ${formatNumber(truncated)} over cap` : ""}.` });
      onCreated(job.id);
      close();
    } catch (err) {
      toast({ variant: "error", title: err instanceof ApiError && err.code === "MISSING_FIELDS" ? "Company Name & Location required" : "Could not start", description: "Please check the file and try again." });
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close} className="max-w-xl">
      <DialogHeader>
        <DialogTitle>Import companies</DialogTitle>
        <DialogDescription>Upload a CSV with <span className="font-medium text-foreground">Company Name</span> and <span className="font-medium text-foreground">Location</span> (both required). We collect the rest from multiple sources.</DialogDescription>
      </DialogHeader>

      {!parsed ? (
        <div className="space-y-3">
          <FileDropzone onFile={onFile} />
          <button onClick={downloadExample} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><Download className="size-3.5" /> Download example CSV</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg bg-valid/10 px-3 py-2 text-sm text-[hsl(var(--valid))]"><CheckCircle2 className="size-4" /> {parsed.fileName} — map the required columns.</div>
          <div className="space-y-1.5"><Label>Job name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Target accounts" /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Company Name <span className="text-[hsl(var(--invalid))]">*</span></Label>
              <Select value={map.company} onChange={(e) => setMap({ ...map, company: e.target.value })}><option value="">—</option>{parsed.columns.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
            </div>
            <div className="space-y-1.5"><Label>Location <span className="text-[hsl(var(--invalid))]">*</span></Label>
              <Select value={map.location} onChange={(e) => setMap({ ...map, location: e.target.value })}><option value="">—</option>{parsed.columns.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span><span className="font-semibold text-foreground">{formatNumber(built.length)}</span> valid rows</span>
            {skipped > 0 && <span className="inline-flex items-center gap-1 text-[hsl(var(--risky))]"><AlertTriangle className="size-3.5" /> {formatNumber(skipped)} rows missing name/location</span>}
          </div>
        </div>
      )}

      <DialogFooter>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button disabled={!parsed || built.length === 0 || !map.company || !map.location || creating} onClick={create}>
          {creating ? <Loader2 className="size-4 animate-spin" /> : null} Collect {built.length > 0 ? formatNumber(built.length) : ""} companies <ArrowRight className="size-4" />
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function sample(): string[][] {
  const co = [["Solara Health", "Sydney, Australia"], ["FinTech Labs", "Melbourne, Australia"], ["Northwind", "Berlin, Germany"], ["Cloudpeak", "London, UK"], ["DataForge", "Singapore"]];
  return co;
}
function downloadExample() {
  const csv = "company,location\nSolara Health,Sydney Australia\nFinTech Labs,Melbourne Australia\nNorthwind,Berlin Germany\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "companies-location-example.csv"; a.click();
  URL.revokeObjectURL(url);
}

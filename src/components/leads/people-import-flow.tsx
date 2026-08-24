"use client";
import * as React from "react";
import Papa from "papaparse";
import { CheckCircle2, ArrowRight, Loader2, Download, AlertTriangle, ChevronDown } from "lucide-react";
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
const COMPANY_RE = /^company$|company.?name|organi|account|^business$|employer|^org$/i;
const LOCATION_RE = /^location$|^city$|^country$|region|address|hq|^state$/i;
const FULLNAME_RE = /full.?name|^name$|contact/i;

/**
 * Optional columns that FILL the people table directly from the CSV (an
 * Apollo-style export). Not required — the crawl still runs and fills gaps
 * (esp. a verified email) — but these show immediately. `not` skips a column
 * that also matches a broader pattern (person LinkedIn vs Company Linkedin).
 */
const OPTIONAL_FIELDS: { key: string; label: string; re: RegExp; not?: RegExp }[] = [
  { key: "title", label: "Title", re: /^title$|job.?title|position|^role$/i },
  { key: "headline", label: "Headline", re: /headline/i },
  { key: "seniority", label: "Seniority", re: /senior/i },
  { key: "department", label: "Department", re: /department/i },
  { key: "personLinkedin", label: "LinkedIn (person)", re: /linked.?in/i, not: /company/i },
  { key: "email", label: "Email", re: /e-?mail/i, not: /domain|catchall|company/i },
  { key: "mobile", label: "Mobile / Phone", re: /mobile|phone|cell|^tel/i, not: /company/i },
  { key: "website", label: "Company Website", re: /company.?website|company.?domain|^website$|^domain$/i },
  { key: "industry", label: "Industry", re: /industry/i },
  { key: "employees", label: "Employees", re: /employees|head.?count|company.?size/i },
  { key: "companyPhone", label: "Company Phone", re: /company.?phone/i },
  { key: "twitter", label: "Twitter", re: /twitter/i, not: /company/i },
  { key: "facebook", label: "Facebook", re: /facebook/i, not: /company/i },
  { key: "photo", label: "Photo", re: /photo|avatar|picture/i },
];

type OptKey = (typeof OPTIONAL_FIELDS)[number]["key"];
type Mapping = { firstName: string; lastName: string; company: string; location: string } & Record<OptKey, string>;
const EMPTY_OPT = Object.fromEntries(OPTIONAL_FIELDS.map((f) => [f.key, ""])) as Record<OptKey, string>;

/** Densest column whose header matches `re` (populated beats sparse); `exclude` skips claimed columns, `not` skips a broader-pattern collision. */
function bestColumn(cols: string[], rows: string[][], re: RegExp, exclude: string[] = [], not?: RegExp): string | undefined {
  let best: string | undefined;
  let bestFill = -1;
  cols.forEach((c, i) => {
    if (exclude.includes(c) || !re.test(c) || (not && not.test(c))) return;
    let fill = 0;
    for (const r of rows) if ((r[i] ?? "").trim()) fill++;
    if (fill > bestFill) { bestFill = fill; best = c; }
  });
  return best;
}

export function PeopleImportFlow({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (jobId: string) => void }) {
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [name, setName] = React.useState("");
  const [map, setMap] = React.useState<Mapping>({ firstName: "", lastName: "", company: "", location: "", ...EMPTY_OPT });
  const [showOptional, setShowOptional] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const { toast } = useToast();

  const reset = () => { setParsed(null); setName(""); setMap({ firstName: "", lastName: "", company: "", location: "", ...EMPTY_OPT }); setShowOptional(false); setCreating(false); };
  const close = () => { onOpenChange(false); setTimeout(reset, 200); };

  const onFile = (file: File) => {
    const finish = (columns: string[], data: string[][]) => {
      const cols = columns.length ? columns : ["first_name", "last_name", "company", "location"];
      setParsed({ fileName: file.name, columns: cols, rows: data });
      const firstName = bestColumn(cols, data, FIRST_RE) ?? bestColumn(cols, data, FULLNAME_RE) ?? cols[0] ?? "";
      const lastName = bestColumn(cols, data, LAST_RE, [firstName]) ?? cols.find((c) => c !== firstName) ?? "";
      const company = bestColumn(cols, data, COMPANY_RE, [firstName, lastName]) ?? "";
      const location = bestColumn(cols, data, LOCATION_RE, [firstName, lastName, company]) ?? "";
      const claimed = [firstName, lastName, company, location];
      const opt = { ...EMPTY_OPT };
      let anyOpt = false;
      for (const f of OPTIONAL_FIELDS) {
        const col = bestColumn(cols, data, f.re, claimed, f.not);
        if (col) { opt[f.key] = col; claimed.push(col); anyOpt = true; }
      }
      setMap({ firstName, lastName, company, location, ...opt });
      setShowOptional(anyOpt); // auto-open when the CSV has rich columns
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
    if (!parsed) return [] as ImportRow[];
    const idx = (col: string) => (col ? parsed.columns.indexOf(col) : -1);
    const fi = idx(map.firstName), lastI = idx(map.lastName), ci = idx(map.company), locI = idx(map.location);
    const optI = Object.fromEntries(OPTIONAL_FIELDS.map((f) => [f.key, idx(map[f.key])])) as Record<OptKey, number>;
    const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const out: ImportRow[] = [];
    for (const r of parsed.rows) {
      let firstName = cell(r, fi);
      let lastName = cell(r, lastI);
      const company = cell(r, ci);
      const location = cell(r, locI);
      // If a single Full Name column was mapped to First Name, split it.
      if (map.firstName === map.lastName || (!lastName && /\s/.test(firstName) && FULLNAME_RE.test(map.firstName))) {
        const parts = firstName.split(/\s+/);
        firstName = parts[0]; lastName = parts.slice(1).join(" ");
      }
      if (!(firstName && lastName && company)) continue;
      const opt = {} as Record<OptKey, string>;
      for (const f of OPTIONAL_FIELDS) opt[f.key] = cell(r, optI[f.key]);
      out.push({ firstName, lastName, company, location, ...opt });
    }
    return out;
  }, [parsed, map]);

  const skipped = parsed ? parsed.rows.length - built.length : 0;
  const optionalMapped = OPTIONAL_FIELDS.filter((f) => map[f.key]).length;
  // Rows that already carry enriched data (LinkedIn / email / title / seniority)
  // → shown as-is, NOT re-enriched. Mirrors seedIsComplete on the server.
  const has = (v?: string) => !!(v && v.trim());
  const asIsCount = built.filter((r) => has(r.personLinkedin) || has(r.email) || has(r.title) || has(r.seniority)).length;

  const create = async () => {
    if (!parsed || built.length === 0) return;
    setCreating(true);
    try {
      const { job, truncated } = await createPeopleJob({
        name: name.trim() || parsed.fileName,
        seeds: built.map((r) => ({
          firstName: r.firstName, lastName: r.lastName, company: r.company, location: r.location,
          title: r.title || undefined, headline: r.headline || undefined, seniority: r.seniority || undefined,
          department: r.department || undefined, personLinkedin: r.personLinkedin || undefined,
          email: r.email || undefined, mobile: r.mobile || undefined,
          website: r.website || undefined, companyIndustry: r.industry || undefined,
          companyEmployees: r.employees || undefined, companyPhone: r.companyPhone || undefined,
          twitter: r.twitter || undefined, facebook: r.facebook || undefined, photo: r.photo || undefined,
        })),
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
          Upload a CSV with <span className="font-medium text-foreground">First Name</span>, <span className="font-medium text-foreground">Last Name</span> and <span className="font-medium text-foreground">Company Name</span> (required). Map any extra columns to <span className="font-medium text-foreground">fill the table directly</span> — title, LinkedIn, seniority, phone and company info. We still find each person's verifiable work email.
        </DialogDescription>
      </DialogHeader>

      {!parsed ? (
        <div className="space-y-3">
          <FileDropzone onFile={onFile} />
          <button onClick={downloadExample} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><Download className="size-3.5" /> Download example CSV</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg bg-valid/10 px-3 py-2 text-sm text-[hsl(var(--valid))]"><CheckCircle2 className="size-4" /> {parsed.fileName} — map the columns.</div>
          <div className="space-y-1.5"><Label>Job name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Target contacts" /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MapField label="First Name" required value={map.firstName} cols={parsed.columns} onChange={(v) => setMap({ ...map, firstName: v })} />
            <MapField label="Last Name" required value={map.lastName} cols={parsed.columns} onChange={(v) => setMap({ ...map, lastName: v })} />
            <MapField label="Company Name" required value={map.company} cols={parsed.columns} onChange={(v) => setMap({ ...map, company: v })} />
            <MapField label="Location" value={map.location} cols={parsed.columns} onChange={(v) => setMap({ ...map, location: v })} />
          </div>

          <div className="rounded-lg border border-border">
            <button type="button" onClick={() => setShowOptional((s) => !s)} className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium">
              <span>Optional fields — fill the table {optionalMapped > 0 && <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{optionalMapped} mapped</span>}</span>
              <ChevronDown className={`size-4 transition-transform ${showOptional ? "rotate-180" : ""}`} />
            </button>
            {showOptional && (
              <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
                {OPTIONAL_FIELDS.map((f) => (
                  <MapField key={f.key} label={f.label} value={map[f.key]} cols={parsed.columns} onChange={(v) => setMap({ ...map, [f.key]: v })} />
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span><span className="font-semibold text-foreground">{formatNumber(built.length)}</span> valid rows{optionalMapped > 0 && ` · ${optionalMapped} extra field${optionalMapped === 1 ? "" : "s"}`}</span>
            {skipped > 0 && <span className="inline-flex items-center gap-1 text-[hsl(var(--risky))]"><AlertTriangle className="size-3.5" /> {formatNumber(skipped)} rows missing first/last/company</span>}
          </div>
          {asIsCount > 0 && (
            <p className="rounded-md bg-valid/10 px-2.5 py-1.5 text-xs text-[hsl(var(--valid))]">
              <span className="font-medium">{formatNumber(asIsCount)}</span> row{asIsCount === 1 ? "" : "s"} already have LinkedIn / title / email — shown <span className="font-medium">directly, no crawl</span>.{built.length > asIsCount && ` The other ${formatNumber(built.length - asIsCount)} (name + company only) are enriched to find their LinkedIn & email.`}
            </p>
          )}
        </div>
      )}

      <DialogFooter>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button disabled={!parsed || built.length === 0 || missingMap || creating} onClick={create}>
          {creating ? <Loader2 className="size-4 animate-spin" /> : null} Import {built.length > 0 ? formatNumber(built.length) : ""} people <ArrowRight className="size-4" />
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

type ImportRow = { firstName: string; lastName: string; company: string; location: string } & Record<OptKey, string>;

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
  const csv =
    "First Name,Last Name,Company Name,Location,Title,Seniority,LinkedIn,Mobile Number,Company Website,Industry,Employees Count\n" +
    "Anthony,Tan,Grab,Singapore,Co-Founder & CEO,founder,http://www.linkedin.com/in/anthonytan,+65 9000 0000,https://grab.com,Technology,5000\n" +
    "Shirley,Koh,Talentsis,Singapore,Founder,founder,http://www.linkedin.com/in/shirleykoh,,https://talentsis.com.sg,Staffing & Recruiting,20\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "people-import-example.csv"; a.click();
  URL.revokeObjectURL(url);
}

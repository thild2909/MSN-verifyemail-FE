"use client";
import * as React from "react";
import Papa from "papaparse";
import {
  FileText, X, CheckCircle2, ArrowRight, Loader2, User, Building2, Download, Coins, Plus, Check,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { FileDropzone } from "@/components/verification/file-dropzone";
import { useToast } from "@/components/ui/toast";
import { createEnrichTable, ApiError } from "@/lib/api/client";
import { columnsForType, DEFAULT_COLUMNS } from "@/lib/enrich/columns";
import { estimateTableCredits } from "@/lib/enrich/cost";
import { ColumnIcon } from "./enrich-ui";
import { formatNumber, cn } from "@/lib/utils";
import type { EnrichColumnKind, EnrichRecordType } from "@/lib/types";

type Step = "idle" | "config" | "creating";
interface Parsed { fileName: string; columns: string[]; rows: string[][]; }

const FIRST_RE = /first|fname|given/i;
const LAST_RE = /last|lname|surname|family/i;
const COMPANY_RE = /company|organi|account|employer|business|website|domain/i;
const EMAIL_RE = /email|e-mail|mail/i;

export function ImportFlow({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [step, setStep] = React.useState<Step>("idle");
  const [recordType, setRecordType] = React.useState<EnrichRecordType>("people");
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [name, setName] = React.useState("");
  const [map, setMap] = React.useState({ first: "", last: "", company: "", email: "" });
  const [selected, setSelected] = React.useState<Set<EnrichColumnKind>>(new Set(DEFAULT_COLUMNS.people));
  const { toast } = useToast();

  const onFile = (file: File) => {
    const finish = (columns: string[], data: string[][]) => {
      const cols = columns.length ? columns : ["company"];
      setParsed({ fileName: file.name, columns: cols, rows: data });
      setMap({
        first: cols.find((c) => FIRST_RE.test(c)) ?? "",
        last: cols.find((c) => LAST_RE.test(c)) ?? "",
        company: cols.find((c) => COMPANY_RE.test(c)) ?? cols[0] ?? "",
        email: cols.find((c) => EMAIL_RE.test(c)) ?? "",
      });
      setName(file.name.replace(/\.[^.]+$/, ""));
      setStep("config");
    };
    if (file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
      Papa.parse(file, {
        skipEmptyLines: true,
        complete: (res) => {
          const data = res.data as string[][];
          if (!data.length) return finish(["first_name", "last_name", "company"], simulate(file));
          const header = data[0].map((h) => String(h).trim());
          const looksHeader = header.some((h) => COMPANY_RE.test(h) || FIRST_RE.test(h) || EMAIL_RE.test(h));
          looksHeader ? finish(header, data.slice(1)) : finish(["company"], data);
        },
        error: () => finish(["first_name", "last_name", "company"], simulate(file)),
      });
    } else finish(["first_name", "last_name", "company"], simulate(file));
  };

  const switchType = (t: EnrichRecordType) => {
    setRecordType(t);
    setSelected(new Set(DEFAULT_COLUMNS[t]));
  };

  const toggleCol = (k: EnrichColumnKind) =>
    setSelected((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // Build canonical rows from the mapping.
  const built = React.useMemo(() => {
    if (!parsed) return { rows: [] as Record<string, string>[], importedColumns: [] as string[], identityColumns: [] as string[] };
    const idx = (col: string) => parsed.columns.indexOf(col);
    const rows: Record<string, string>[] = [];
    if (recordType === "people") {
      const fi = idx(map.first), li = idx(map.last), ci = idx(map.company), ei = idx(map.email);
      for (const r of parsed.rows) {
        const rec: Record<string, string> = {};
        if (fi >= 0) rec.first_name = (r[fi] ?? "").trim();
        if (li >= 0) rec.last_name = (r[li] ?? "").trim();
        if (ci >= 0) rec.company = (r[ci] ?? "").trim();
        if (ei >= 0 && (r[ei] ?? "").trim()) rec.email = (r[ei] ?? "").trim();
        if (rec.first_name || rec.last_name || rec.company) rows.push(rec);
      }
      const importedColumns = ["first_name", "last_name", "company", ...(map.email ? ["email"] : [])];
      return { rows, importedColumns, identityColumns: ["first_name", "last_name", "company"] };
    }
    const ci = idx(map.company);
    for (const r of parsed.rows) {
      const v = (r[ci] ?? "").trim();
      if (v) rows.push({ company: v });
    }
    return { rows, importedColumns: ["company"], identityColumns: ["company"] };
  }, [parsed, map, recordType]);

  const uniqueCount = React.useMemo(() => {
    const seen = new Set<string>();
    for (const r of built.rows) {
      const key = built.identityColumns.map((c) => (r[c] ?? "").toLowerCase()).join("|");
      if (key.replace(/\|/g, "")) seen.add(key);
    }
    return seen.size;
  }, [built]);

  const estimate = estimateTableCredits(uniqueCount, [...selected].map((k) => ({ costPerRow: columnsForType(recordType).find((c) => c.kind === k)!.costPerRow })));

  const create = async () => {
    if (built.rows.length === 0) return;
    setStep("creating");
    try {
      const { table, truncated } = await createEnrichTable({
        name: name.trim() || parsed!.fileName,
        fileName: parsed!.fileName,
        recordType,
        importedColumns: built.importedColumns,
        identityColumns: built.identityColumns,
        rows: built.rows,
        columns: [...selected],
      });
      toast({ variant: "success", title: "Enrichment started", description: `${formatNumber(table.summary.rows)} rows${truncated ? ` · ${formatNumber(truncated)} over the cap` : ""}.` });
      onCreated(table.id);
    } catch (err) {
      const insufficient = err instanceof ApiError && err.code === "INSUFFICIENT_CREDITS";
      toast({ variant: "error", title: insufficient ? "Insufficient credits" : "Could not start", description: insufficient ? "Top up and try again." : "Please try again." });
      setStep("config");
    }
  };

  if (step === "idle") {
    return (
      <div className="space-y-3">
        <FileDropzone onFile={onFile} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Import a list of people or companies, then add enrichment columns (email, phone, company data…).</span>
          <div className="flex items-center gap-3">
            <button onClick={downloadExample} className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><Download className="size-3.5" /> Example CSV</button>
            <button onClick={onCancel} className="font-medium hover:text-foreground">Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  const available = columnsForType(recordType);

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText className="size-5" /></div>
            <div>
              <p className="text-sm font-semibold">{parsed?.fileName}</p>
              <p className="text-xs text-muted-foreground">{formatNumber(uniqueCount)} unique records detected</p>
            </div>
          </div>
          {step !== "creating" && <button onClick={onCancel} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Cancel"><X className="size-4" /></button>}
        </div>

        {/* Record type */}
        <div className="grid grid-cols-2 gap-2">
          <TypeCard active={recordType === "people"} icon={User} label="People" hint="Find & verify work emails, phones, LinkedIn" onClick={() => switchType("people")} />
          <TypeCard active={recordType === "companies"} icon={Building2} label="Companies" hint="Firmographics, technographics, role emails" onClick={() => switchType("companies")} />
        </div>

        {/* Mapping */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Map columns</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {recordType === "people" ? (
              <>
                <MapField label="First name" value={map.first} cols={parsed!.columns} onChange={(v) => setMap({ ...map, first: v })} />
                <MapField label="Last name" value={map.last} cols={parsed!.columns} onChange={(v) => setMap({ ...map, last: v })} />
                <MapField label="Company / domain" value={map.company} cols={parsed!.columns} onChange={(v) => setMap({ ...map, company: v })} />
                <MapField label="Email (optional)" value={map.email} cols={parsed!.columns} onChange={(v) => setMap({ ...map, email: v })} />
              </>
            ) : (
              <MapField label="Company / domain" value={map.company} cols={parsed!.columns} onChange={(v) => setMap({ ...map, company: v })} />
            )}
          </div>
        </div>

        {/* Starting enrichments */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Starting enrichment columns</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {available.map((c) => {
              const on = selected.has(c.kind);
              return (
                <button key={c.kind} onClick={() => toggleCol(c.kind)} className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors", on ? "border-primary bg-primary/5" : "border-input hover:bg-muted/50")}>
                  <span className={cn("mt-0.5 flex size-8 items-center justify-center rounded-md", on ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}><ColumnIcon kind={c.kind} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">{c.name}<span className="text-[10px] text-muted-foreground">· {c.costPerRow} cr/row</span></span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">{c.description}</span>
                  </span>
                  <span className={cn("mt-1 flex size-4 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>{on && <Check className="size-3" />}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Name + estimate + submit */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Table name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 target accounts" /></div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="flex items-center gap-2 text-sm">
            <Coins className="size-4 text-primary" />
            <span className="font-medium">{formatNumber(estimate)} credits</span>
            <span className="text-muted-foreground">for {formatNumber(uniqueCount)} rows × {selected.size} columns</span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={step === "creating"}>Cancel</Button>
            <Button onClick={create} disabled={step === "creating" || uniqueCount === 0 || selected.size === 0}>
              {step === "creating" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create table <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------- helpers -------------------------------- */

function TypeCard({ active, icon: Icon, label, hint, onClick }: { active: boolean; icon: React.ElementType; label: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors", active ? "border-primary bg-primary/5" : "border-input hover:bg-muted/50")}>
      <span className={cn("flex size-9 items-center justify-center rounded-lg", active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}><Icon className="size-5" /></span>
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

function MapField({ label, value, cols, onChange }: { label: string; value: string; cols: string[]; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {cols.map((c) => <option key={c} value={c}>{c}</option>)}
      </Select>
    </div>
  );
}

function simulate(file: File): string[][] {
  const est = Math.max(8, Math.round(file.size / 80));
  const first = ["John", "Sarah", "David", "Emily", "Michael"];
  const last = ["Smith", "Lee", "Wong", "Brown", "Chen"];
  const co = ["acme.com", "globex.io", "Initech", "umbrella.com", "Stark Industries"];
  return Array.from({ length: est }, (_, i) => [first[i % 5], last[i % 5], co[i % 5]]);
}

function downloadExample() {
  const csv = "first_name,last_name,company\nJohn,Smith,acme.com\nSarah,Lee,globex.io\nDavid,Wong,Initech Inc\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "records-example.csv"; a.click();
  URL.revokeObjectURL(url);
}

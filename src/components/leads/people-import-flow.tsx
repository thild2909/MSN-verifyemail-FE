"use client";
import * as React from "react";
import Papa from "papaparse";
import { ArrowRight, Loader2, Download, AlertTriangle, ChevronDown, UserPlus, FileSpreadsheet, ListChecks, Check, Link2, Columns3, RefreshCw, Layers, Zap, Plus } from "lucide-react";
import { colHeadMeta } from "@/components/common/col-head";
import { OPTIONAL_FIELDS, EMPTY_OPT, FIRST_RE, LAST_RE, COMPANY_RE, FULLNAME_RE, autoMap, type Mapping, type OptKey } from "@/lib/leads/people-import-map";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FileDropzone } from "@/components/verification/file-dropzone";
import { useToast } from "@/components/ui/toast";
import { createPeopleJob, matchLeadItems, ApiError, type LeadItem } from "@/lib/api/client";
import type { CollectedPerson } from "@/lib/leads/people-types";
import { formatNumber, cn } from "@/lib/utils";
import { IconTile, Field, Pill, TONES } from "@/components/common/kit";

interface Parsed { fileName: string; columns: string[]; rows: string[][] }
export function PeopleImportFlow({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (jobId: string) => void }) {
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [name, setName] = React.useState("");
  const [apolloUrl, setApolloUrl] = React.useState("");
  const [map, setMap] = React.useState<Mapping>({ firstName: "", lastName: "", company: "", city: "", state: "", country: "", ...EMPTY_OPT });
  const [showOptional, setShowOptional] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  // Rows already saved in a list (import dedup), keyed by built-row index → snapshot.
  const [matches, setMatches] = React.useState<Record<string, LeadItem>>({});
  const [matching, setMatching] = React.useState(false);
  const { toast } = useToast();

  const reset = () => { setParsed(null); setName(""); setApolloUrl(""); setMap({ firstName: "", lastName: "", company: "", city: "", state: "", country: "", ...EMPTY_OPT }); setShowOptional(false); setCreating(false); setMatches({}); };
  const close = () => { onOpenChange(false); setTimeout(reset, 200); };

  const onFile = (file: File) => {
    const finish = (columns: string[], data: string[][]) => {
      const cols = columns.length ? columns : ["first_name", "last_name", "company", "location"];
      setParsed({ fileName: file.name, columns: cols, rows: data });
      const m = autoMap(cols, data);
      setMap(m);
      setShowOptional(false);
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
    const fi = idx(map.firstName), lastI = idx(map.lastName), ci = idx(map.company);
    const cityI = idx(map.city), stateI = idx(map.state), countryI = idx(map.country);
    const optI = Object.fromEntries(OPTIONAL_FIELDS.map((f) => [f.key, idx(map[f.key])])) as Record<OptKey, number>;
    const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const out: ImportRow[] = [];
    for (const r of parsed.rows) {
      let firstName = cell(r, fi);
      let lastName = cell(r, lastI);
      const company = cell(r, ci);
      // Keep the raw City/State/Country (for export) and a combined Location for display.
      const city = cell(r, cityI), state = cell(r, stateI), country = cell(r, countryI);
      const location = [city, state, country].filter(Boolean).join(", ");
      // If a single Full Name column was mapped to First Name, split it.
      if (map.firstName === map.lastName || (!lastName && /\s/.test(firstName) && FULLNAME_RE.test(map.firstName))) {
        const parts = firstName.split(/\s+/);
        firstName = parts[0]; lastName = parts.slice(1).join(" ");
      }
      // Keep the row when it has a name (first OR last) and a company. Only
      // rows missing BOTH names — or the company — are skipped.
      if (!((firstName || lastName) && company)) continue;
      const opt = {} as Record<OptKey, string>;
      for (const f of OPTIONAL_FIELDS) opt[f.key] = cell(r, optI[f.key]);
      out.push({ firstName, lastName, company, location, city, state, country, ...opt, raw: parsed.columns.map((_c, i) => r[i] ?? "") });
    }
    return out;
  }, [parsed, map]);

  // Cross-reference the built rows against every saved list. A hit means the
  // person is already enriched somewhere, so we reuse that snapshot (no crawl).
  React.useEffect(() => {
    setMatches({}); // drop stale hits before re-matching — indices shift when the mapping changes
    if (built.length === 0) return;
    let cancelled = false;
    setMatching(true);
    matchLeadItems({
      people: built.map((r, i) => ({ key: String(i), name: `${r.firstName} ${r.lastName}`.trim(), company: r.company, email: r.email || undefined })),
    })
      .then((res) => { if (!cancelled) setMatches(res.people); })
      .catch(() => { if (!cancelled) setMatches({}); })
      .finally(() => { if (!cancelled) setMatching(false); });
    return () => { cancelled = true; };
  }, [built]);

  /** Per-column fill count + first sample value (drives the mapping preview). */
  const stats = React.useMemo<ColStats>(() => {
    const out: ColStats = { columns: [], byName: {} };
    if (!parsed) return out;
    out.columns = parsed.columns;
    parsed.columns.forEach((c, i) => {
      let fill = 0;
      let sample = "";
      for (const r of parsed.rows) {
        const v = (r[i] ?? "").trim();
        if (v) { fill++; if (!sample) sample = v; }
      }
      out.byName[c] = { fill, sample, total: parsed.rows.length };
    });
    return out;
  }, [parsed]);

  const usedColumns = new Set(Object.values(map).filter(Boolean));
  const mappedTotal = usedColumns.size;
  const emptyColumns = parsed ? parsed.columns.filter((c) => !stats.byName[c]?.fill) : [];
  const extraColumns = parsed ? parsed.columns.filter((c) => stats.byName[c]?.fill && !usedColumns.has(c)) : [];
  const unmappedFields = [
    ...(!map.city ? [{ key: "city", label: "City" }] : []),
    ...(!map.state ? [{ key: "state", label: "State" }] : []),
    ...(!map.country ? [{ key: "country", label: "Country" }] : []),
    ...OPTIONAL_FIELDS.filter((f) => !map[f.key]).map((f) => ({ key: f.key as string, label: f.label as string })),
  ];

  const matchedCount = React.useMemo(() => built.reduce((n, _r, i) => (matches[String(i)] ? n + 1 : n), 0), [built, matches]);

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
        apolloUrl: apolloUrl.trim() || undefined,
        sourceColumns: parsed.columns,
        seeds: built.map((r, i) => ({
          // A saved-list hit fills the row straight from its snapshot — no crawl.
          prefill: (matches[String(i)]?.data as unknown as CollectedPerson | undefined) ?? undefined,
          firstName: r.firstName, lastName: r.lastName, company: r.company, location: r.location,
          city: r.city || undefined, state: r.state || undefined, country: r.country || undefined,
          title: r.title || undefined, headline: r.headline || undefined, seniority: r.seniority || undefined,
          department: r.department || undefined, personLinkedin: r.personLinkedin || undefined,
          email: r.email || undefined, mobile: r.mobile || undefined,
          website: r.website || undefined, companyIndustry: r.industry || undefined,
          companyEmployees: r.employees || undefined, companyPhone: r.companyPhone || undefined,
          twitter: r.twitter || undefined, facebook: r.facebook || undefined, photo: r.photo || undefined,
          keywords: r.keywords || undefined, companyLinkedin: r.companyLinkedin || undefined,
          companyRevenue: r.companyRevenue || undefined, companyFunding: r.companyFunding || undefined,
          companyTechnologies: r.companyTechnologies || undefined, companyFoundedYear: r.companyFoundedYear || undefined,
          companySeoDescription: r.companySeoDescription || undefined, companyShortDescription: r.companyShortDescription || undefined,
          sourceRow: r.raw,
        })),
      });
      toast({ variant: "success", title: "Finding people…", description: `Enriching ${formatNumber(job.totalCompanies)} people${truncated ? ` · ${formatNumber(truncated)} over cap` : ""}.` });
      onCreated(job.id);
      close();
    } catch (err) {
      // Rows missing a name/company are already skipped (see `built`/`skipped`),
      // so this only fires on a real failure — surface the actual reason.
      toast({ variant: "error", title: "Could not start", description: err instanceof ApiError ? err.message : "Something went wrong starting the import. Please try again." });
      setCreating(false);
    }
  };

  const missingMap = (!map.firstName && !map.lastName) || !map.company;
  const apolloTrimmed = apolloUrl.trim();
  const apolloValid = /^https?:\/\/\S+$/i.test(apolloTrimmed);
  const apolloError = apolloTrimmed.length > 0 && !apolloValid;

  // Visual step only: 1 Upload → 2 Map columns → 3 Ready to import.
  const step = !parsed ? 1 : missingMap || built.length === 0 ? 2 : 3;

  return (
    <Dialog open={open} onOpenChange={close} className={cn("sm:max-w-2xl", parsed && "sm:max-w-6xl")}>
      <DialogHeader>
        <div className="mb-3 flex items-center justify-between gap-3">
          <IconTile icon={UserPlus} tone="brand" />
          <StepDots step={step} />
        </div>
        <DialogTitle>Import people</DialogTitle>
        <DialogDescription>
          Upload a list with <span className="font-medium text-foreground">name</span> and <span className="font-medium text-foreground">company</span>. Every column with data is mapped automatically, and we find each person&apos;s verified work email.
        </DialogDescription>
      </DialogHeader>

      {(() => {
        const apolloField = (
          <Field
            label={<><Link2 className="size-3.5 text-muted-foreground" strokeWidth={1.75} /> Apollo list URL <span className="text-[hsl(var(--invalid))]">*</span></>}
            htmlFor="people-import-apollo"
            error={apolloError ? "Enter a valid URL starting with http:// or https://" : undefined}
            hint="Saved with this import so you can reopen the source list."
          >
            <Input
              id="people-import-apollo"
              type="url"
              value={apolloUrl}
              onChange={(e) => setApolloUrl(e.target.value)}
              placeholder="https://app.apollo.io/#/people?..."
              autoComplete="off"
              className={cn(apolloError && "border-[hsl(var(--invalid))] focus-visible:ring-[hsl(var(--invalid)/0.3)]")}
            />
          </Field>
        );

        if (!parsed) {
          return (
            <div className="mx-auto w-full max-w-2xl space-y-4">
              {apolloField}
              <FileDropzone onFile={onFile} />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>Required: <span className="font-medium text-foreground">First name</span>, <span className="font-medium text-foreground">Last name</span>, <span className="font-medium text-foreground">Company</span></span>
                <button onClick={downloadExample} className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-medium text-brand transition-colors hover:bg-brand/10">
                  <Download className="size-3.5" strokeWidth={1.75} /> Example CSV
                </button>
              </div>
            </div>
          );
        }

        const requiredMapped = [map.firstName, map.lastName, map.company].filter(Boolean).length;
        const locationMapped = [map.city, map.state, map.country].filter(Boolean).length;

        return (
          <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
            {/* ---------- Left: source + readiness ---------- */}
            <aside className="space-y-4">
              {/* File summary */}
              <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
                <div className="flex items-center gap-3">
                  <IconTile icon={FileSpreadsheet} tone="valid" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold" title={parsed.fileName}>{parsed.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="tabular-nums">{formatNumber(parsed.rows.length)}</span> rows · <span className="tabular-nums">{parsed.columns.length}</span> columns
                    </p>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => { setParsed(null); setMatches({}); }} className="size-8 shrink-0 text-muted-foreground" aria-label="Replace file" title="Replace file">
                    <RefreshCw />
                  </Button>
                </div>
                <div className="mt-3 flex h-1.5 gap-[2px] overflow-hidden rounded-full" aria-hidden>
                  <span className="h-full rounded-full bg-[hsl(var(--valid))]" style={{ flexGrow: mappedTotal }} />
                  <span className="h-full rounded-full bg-[hsl(280_62%_55%)]" style={{ flexGrow: extraColumns.length }} />
                  <span className="h-full rounded-full bg-border" style={{ flexGrow: emptyColumns.length }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[hsl(var(--valid))]" /> <b className="font-semibold tabular-nums text-foreground">{mappedTotal}</b> mapped</span>
                  <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[hsl(280_62%_55%)]" /> <b className="font-semibold tabular-nums text-foreground">{extraColumns.length}</b> extra</span>
                  <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-border" /> <b className="font-semibold tabular-nums text-foreground">{emptyColumns.length}</b> empty</span>
                </div>
              </div>

              <Field label="Job name" htmlFor="people-import-name">
                <Input id="people-import-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Target contacts" autoComplete="off" />
              </Field>

              {apolloField}

              {/* Readiness */}
              <div className="space-y-2">
                <ReadyStat icon={ListChecks} tone="brand" value={built.length} label="rows to import" />
                <ReadyStat icon={Zap} tone="valid" value={asIsCount} label="shown directly, no crawl" />
                <ReadyStat icon={AlertTriangle} tone={skipped > 0 ? "risky" : "muted"} value={skipped} label="missing name or company" />
              </div>
              {matching && <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden /> Checking your lists for matches…</p>}
              {matchedCount > 0 && (
                <p className={cn("rounded-lg px-3 py-2 text-xs", TONES.brand)}>
                  <span className="font-semibold tabular-nums">{formatNumber(matchedCount)}</span> row{matchedCount === 1 ? " is" : "s are"} already in your Lists, filled from the saved record (no crawl).
                </p>
              )}

              {/* Extra / empty columns */}
              {extraColumns.length > 0 && (
                <div className="rounded-xl border border-dashed border-border p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <Layers className="size-3.5 text-[hsl(280_62%_55%)] dark:text-[hsl(280_80%_76%)]" strokeWidth={1.9} />
                    Kept as extra columns
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">No matching field — stored as-is and included in exports.</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {extraColumns.map((c) => (
                      <span key={c} className="inline-flex max-w-[12rem] items-center rounded-md bg-surface px-1.5 py-0.5 text-[11px]"><span className="truncate">{c}</span></span>
                    ))}
                  </div>
                </div>
              )}
              {emptyColumns.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Skipped empty: <span className="text-foreground">{emptyColumns.slice(0, 6).join(", ")}{emptyColumns.length > 6 ? `, +${emptyColumns.length - 6} more` : ""}</span>
                </p>
              )}
            </aside>

            {/* ---------- Right: mapping table ---------- */}
            <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <IconTile icon={Columns3} tone="violet" size="sm" />
                  <div>
                    <p className="text-sm font-semibold leading-tight">Column mapping</p>
                    <p className="text-xs text-muted-foreground">Auto-matched from your headers — change any field.</p>
                  </div>
                </div>
              </div>

              {/* Column headings (desktop) */}
              <div className={cn(MAP_GRID, "hidden border-b border-border bg-surface px-4 py-2 text-[12px] text-muted-foreground md:grid")}>
                <span>Field</span>
                <span />
                <span>Column in your file</span>
                <span>Sample value</span>
                <span className="text-right">Filled</span>
              </div>

              <MapGroup title="Required" mapped={requiredMapped} total={3}>
                <MapRow label="First Name" required value={map.firstName} stats={stats} onChange={(v) => setMap({ ...map, firstName: v })} />
                <MapRow label="Last Name" required value={map.lastName} stats={stats} onChange={(v) => setMap({ ...map, lastName: v })} />
                <MapRow label="Company Name" required value={map.company} stats={stats} onChange={(v) => setMap({ ...map, company: v })} />
              </MapGroup>

              {locationMapped > 0 && (
                <MapGroup title="Location" mapped={locationMapped} total={locationMapped}>
                  {map.city && <MapRow label="City" value={map.city} stats={stats} onChange={(v) => setMap({ ...map, city: v })} />}
                  {map.state && <MapRow label="State" value={map.state} stats={stats} onChange={(v) => setMap({ ...map, state: v })} />}
                  {map.country && <MapRow label="Country" value={map.country} stats={stats} onChange={(v) => setMap({ ...map, country: v })} />}
                </MapGroup>
              )}

              {optionalMapped > 0 && (
                <MapGroup title="Fills the table" mapped={optionalMapped} total={optionalMapped}>
                  {OPTIONAL_FIELDS.filter((f) => map[f.key]).map((f) => (
                    <MapRow key={f.key} label={f.label} value={map[f.key]} stats={stats} onChange={(v) => setMap({ ...map, [f.key]: v })} />
                  ))}
                </MapGroup>
              )}

              {/* Fields the file doesn't have — collapsed, mappable by hand */}
              {unmappedFields.length > 0 && (
                <div className="border-t border-border">
                  <button
                    type="button"
                    onClick={() => setShowOptional((s) => !s)}
                    className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-surface/60 hover:text-foreground"
                    aria-expanded={showOptional}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Plus className="size-4" strokeWidth={1.75} />
                      Map more fields
                      <span className="rounded bg-surface px-1.5 text-[10px] font-semibold tabular-nums">{unmappedFields.length} not in file</span>
                    </span>
                    <ChevronDown className={cn("size-4 transition-transform", showOptional && "rotate-180")} />
                  </button>
                  {showOptional && (
                    <div className="divide-y divide-border/60 border-t border-border bg-surface/30">
                      {unmappedFields.map((f) => (
                        <MapRow key={f.key} label={f.label} value={map[f.key as keyof Mapping] as string} stats={stats} onChange={(v) => setMap({ ...map, [f.key]: v })} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        );
      })()}

      <DialogFooter className="border-t border-border pt-4">
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button disabled={!parsed || built.length === 0 || missingMap || !apolloValid || creating} onClick={create}>
          {creating ? <Loader2 className="animate-spin" /> : null} Import {built.length > 0 ? formatNumber(built.length) : ""} people <ArrowRight />
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

const STEPS = ["Upload", "Map", "Import"] as const;

/** Compact 3-step indicator: done = valid tick, current = brand, upcoming = muted. */
function StepDots({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-1.5 pr-8" aria-label={`Step ${step} of ${STEPS.length}`}>
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <li key={label} className="flex items-center gap-1.5">
            {i > 0 && <span className={cn("h-px w-3 sm:w-5", done || current ? "bg-brand/40" : "bg-border")} aria-hidden />}
            <span className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
              done ? TONES.valid : current ? TONES.brand : TONES.muted,
            )}>
              <span className="flex size-3.5 items-center justify-center tabular-nums">{done ? <Check className="size-3" strokeWidth={2.5} /> : n}</span>
              <span className={cn(!current && "hidden sm:inline")}>{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

type ImportRow = { firstName: string; lastName: string; company: string; location: string; city: string; state: string; country: string; raw: string[] } & Record<OptKey, string>;

interface ColStats { columns: string[]; byName: Record<string, { fill: number; sample: string; total: number }> }

/** Field · arrow · column · sample · filled — shared by the heading row and every mapping row. */
const MAP_GRID = "md:grid md:grid-cols-[minmax(0,1fr)_16px_minmax(0,1.15fr)_minmax(0,1fr)_88px] md:items-center md:gap-3";

function MapGroup({ title, mapped, total, children }: { title: string; mapped: number; total: number; children: React.ReactNode }) {
  const complete = mapped >= total && total > 0;
  return (
    <div className="border-t border-border first:border-t-0">
      <div className="flex items-center gap-2 bg-surface/50 px-4 py-1.5">
        <p className="text-[11px] font-semibold text-muted-foreground">{title}</p>
        <span className={cn("inline-flex items-center gap-1 rounded px-1 text-[10px] font-semibold tabular-nums", complete ? TONES.valid : TONES.risky)}>
          {complete && <Check className="size-2.5" strokeWidth={3} />} {mapped}/{total}
        </span>
      </div>
      <div className="divide-y divide-border/60">{children}</div>
    </div>
  );
}

/** One mapping line: meaning-tinted field tile → source column, its first sample value and fill rate. */
function MapRow({ label, required, value, stats, onChange }: { label: string; required?: boolean; value: string; stats: ColStats; onChange: (v: string) => void }) {
  const s = value ? stats.byName[value] : undefined;
  const pct = s && s.total ? Math.round((s.fill / s.total) * 100) : 0;
  const missing = required && !value;
  const meta = colHeadMeta(label);
  const Glyph = meta?.icon;
  const barTone = pct >= 80 ? "bg-[hsl(var(--valid))]" : pct >= 30 ? "bg-[hsl(var(--risky))]" : "bg-muted-foreground/50";
  return (
    <div className={cn("space-y-2 px-4 py-2.5 transition-colors hover:bg-surface/40 md:space-y-0", MAP_GRID, missing && "bg-[hsl(var(--invalid)/0.04)]")}>
      {/* Field */}
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface">
          {Glyph ? <Glyph className={cn("size-3.5", meta?.tone)} strokeWidth={1.9} /> : <Columns3 className="size-3.5 text-muted-foreground" />}
        </span>
        <span className="min-w-0 truncate text-[13px] font-medium" title={label}>{label}</span>
        {required && <span className="shrink-0 text-[hsl(var(--invalid))]">*</span>}
      </div>

      {/* Arrow */}
      <ArrowRight className={cn("hidden size-4 md:block", value ? "text-[hsl(var(--valid))]" : "text-muted-foreground/40")} strokeWidth={1.9} />

      {/* Column picker */}
      <Select value={value} onChange={(e) => onChange(e.target.value)} className={cn("h-8 bg-card text-[13px]", !value && "text-muted-foreground", missing && "border-[hsl(var(--invalid))]")}>
        <option value="">— Not mapped —</option>
        {stats.columns.map((c) => (
          <option key={c} value={c}>{stats.byName[c]?.fill ? c : `${c} (empty)`}</option>
        ))}
      </Select>

      {/* Sample */}
      <div className="min-w-0 text-[12px]">
        {s ? (
          <span className="block truncate rounded-md bg-surface px-2 py-1 font-mono text-[11px] text-foreground" title={s.sample}>{s.sample || "—"}</span>
        ) : (
          <span className="text-muted-foreground/60">{missing ? "Required" : "—"}</span>
        )}
      </div>

      {/* Filled */}
      <div className="flex items-center gap-2 md:justify-end">
        {s ? (
          <>
            <span className="h-1.5 w-12 overflow-hidden rounded-full bg-border">
              <span className={cn("block h-full rounded-full", barTone)} style={{ width: `${pct}%` }} />
            </span>
            <span className="w-9 text-right text-[11px] font-semibold tabular-nums">{pct}%</span>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground/60">—</span>
        )}
      </div>
    </div>
  );
}

function ReadyStat({ icon: Icon, tone, value, label }: { icon: React.ElementType; tone: "brand" | "valid" | "risky" | "muted"; value: number; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <IconTile icon={Icon} tone={tone} size="sm" />
      <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{formatNumber(value)}</span>
    </div>
  );
}

function downloadExample() {
  const csv =
    "First Name,Last Name,Company Name,City,State,Country,Title,Seniority,LinkedIn,Mobile Number,Company Website,Industry,Employees Count\n" +
    "Anthony,Tan,Grab,Singapore,,Singapore,Co-Founder & CEO,founder,http://www.linkedin.com/in/anthonytan,+65 9000 0000,https://grab.com,Technology,5000\n" +
    "Shirley,Koh,Talentsis,Singapore,,Singapore,Founder,founder,http://www.linkedin.com/in/shirleykoh,,https://talentsis.com.sg,Staffing & Recruiting,20\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "people-import-example.csv"; a.click();
  URL.revokeObjectURL(url);
}

"use client";
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Radar, Check, Building2 } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { IconTile, Field } from "@/components/common/kit";
import { createLinkedInSearch } from "@/lib/api/client";
import { TokenList } from "./filter-primitives";
import {
  LINKEDIN_ROLE_FAMILIES, LINKEDIN_DATE_LABEL, LINKEDIN_JOB_TYPES, LINKEDIN_JOB_TYPE_LABEL,
  type LinkedInDatePosted, type LinkedInJobType, type LinkedInSearchMode,
} from "@/lib/leads/linkedin-jobs-types";

const DATE_OPTIONS: LinkedInDatePosted[] = ["24h", "7d", "30d", "any"];
const DEPTH_OPTIONS = [
  { v: 0, l: "All results — auto-split past LinkedIn's 1,000 cap (recommended)" },
  { v: 10, l: "Top ~100 roles (fast)" }, { v: 30, l: "Top ~300 roles" }, { v: 100, l: "Top ~1,000 roles" },
];
const SEARCH_MODE_OPTIONS: Array<{ v: LinkedInSearchMode; l: string; hint: string }> = [
  { v: "normal", l: "Normal search", hint: "Python" },
  { v: "polygon", l: "Polygon search", hint: "“python” — exact phrase" },
];
const EMPLOYEE_OPTIONS = [
  { v: 0, l: "No maximum" }, { v: 50, l: "Up to 50" }, { v: 200, l: "Up to 200" },
  { v: 500, l: "Up to 500" }, { v: 1000, l: "Up to 1,000" }, { v: 5000, l: "Up to 5,000" },
];

/**
 * Composer for a new LinkedIn scrape. One discovery query runs per
 * keyword × location pair. Company-size / industry are the qualification
 * criteria applied by the opt-in "Qualify companies" pass after the crawl.
 */
export function LinkedInJobsCrawlDialog({
  open, onOpenChange, seed, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  seed?: { keywords?: string[]; locations?: string[] };
  onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const [keywords, setKeywords] = React.useState<string[]>(seed?.keywords ?? []);
  const [locations, setLocations] = React.useState<string[]>(seed?.locations ?? []);
  const [datePosted, setDatePosted] = React.useState<LinkedInDatePosted>("7d");
  const [jobType, setJobType] = React.useState<LinkedInJobType>("full_time");
  const [searchMode, setSearchMode] = React.useState<LinkedInSearchMode>("normal");
  const [targetRoles, setTargetRoles] = React.useState<string[]>([]);
  const [maxPages, setMaxPages] = React.useState(0);
  const [employeeMax, setEmployeeMax] = React.useState(0);
  const [targetIndustries, setTargetIndustries] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (open && seed) { setKeywords(seed.keywords ?? []); setLocations(seed.locations ?? []); }
  }, [open, seed]);

  const toggleRole = (r: string) => setTargetRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const maxAgeDays = datePosted === "24h" ? 1 : datePosted === "7d" ? 7 : datePosted === "30d" ? 30 : 0;

  const create = useMutation({
    mutationFn: () =>
      createLinkedInSearch({
        name: `${keywords.join(", ")}${locations.length ? ` · ${locations.join(", ")}` : ""}`.slice(0, 120) || "LinkedIn scrape",
        params: { keywords, locations, datePosted, jobType, searchMode, targetRoles, maxAgeDays, maxPages, employeeMax, targetIndustries },
      }),
    onSuccess: (job) => {
      const combos = keywords.length * Math.max(1, locations.length);
      toast({ variant: "success", title: "Scrape started", description: `Discovering LinkedIn roles across ${combos} quer${combos === 1 ? "y" : "ies"}.` });
      onCreated(job.id);
      onOpenChange(false);
    },
    onError: (e) => toast({ variant: "error", title: "Couldn't start scrape", description: e instanceof Error ? e.message : "Try again." }),
  });

  const canSubmit = keywords.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-2xl">
      <DialogHeader className="flex items-start gap-3 space-y-0 pr-8">
        <IconTile icon={Radar} tone="sky" />
        <div className="min-w-0 space-y-1">
          <DialogTitle className="text-base">Scrape LinkedIn jobs</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">Discover open technical roles from LinkedIn&rsquo;s public job search. One query runs per keyword × location.</DialogDescription>
        </div>
      </DialogHeader>

      <div className="-mx-1 max-h-[65vh] space-y-5 overflow-y-auto scrollbar-thin px-1 py-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={<>Keywords <span className="font-normal text-muted-foreground">(one per role search)</span></>}>
            <TokenList values={keywords} onChange={setKeywords} placeholder="e.g. Python Developer" />
          </Field>
          <Field label={<>Locations <span className="font-normal text-muted-foreground">(optional)</span></>}>
            <TokenList values={locations} onChange={setLocations} placeholder="Singapore / Germany" />
          </Field>
        </div>

        <Field label="Search mode">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Search mode">
            {SEARCH_MODE_OPTIONS.map((o) => {
              const on = searchMode === o.v;
              return (
                <button key={o.v} type="button" role="radio" aria-checked={on} onClick={() => setSearchMode(o.v)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left text-xs transition-all",
                    on ? "border-brand ring-[3px] ring-brand/15" : "border-border hover:border-brand/40 hover:bg-surface/60",
                  )}>
                  <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors", on ? "border-brand bg-brand" : "border-input bg-card")}>
                    {on && <span className="size-1.5 rounded-full bg-card" />}
                  </span>
                  <span className={cn("flex-1 font-medium", on ? "text-foreground" : "text-foreground/90")}>{o.l}</span>
                  <span className={cn("rounded-md px-1.5 py-0.5 font-mono text-[11px]", on ? "bg-brand/10 text-brand" : "bg-surface text-muted-foreground")}>{o.hint}</span>
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Date posted">
          <div className="grid grid-cols-2 gap-0.5 rounded-lg border border-border bg-surface p-0.5 sm:inline-grid sm:grid-cols-4" role="radiogroup" aria-label="Date posted">
            {DATE_OPTIONS.map((d) => {
              const on = datePosted === d;
              return (
                <button key={d} type="button" role="radio" aria-checked={on} onClick={() => setDatePosted(d)}
                  className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    on ? "bg-card text-brand shadow-xs" : "text-muted-foreground hover:text-foreground")}>
                  {LINKEDIN_DATE_LABEL[d]}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Job type">
            <Select value={jobType} onChange={(e) => setJobType(e.target.value as LinkedInJobType)}>
              {LINKEDIN_JOB_TYPES.map((t) => <option key={t} value={t}>{LINKEDIN_JOB_TYPE_LABEL[t]}</option>)}
            </Select>
          </Field>
          <Field
            label="Depth per query"
            hint={<>LinkedIn serves ≤1,000 per search — &ldquo;All results&rdquo; splits the search to reach the full total; slower.</>}
          >
            <Select value={String(maxPages)} onChange={(e) => setMaxPages(Number(e.target.value))}>
              {DEPTH_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </Select>
          </Field>
        </div>

        <Field
          label="Target roles"
          aside={<span className={cn("text-[11px]", targetRoles.length > 0 ? "font-semibold text-brand" : "text-muted-foreground")}>{targetRoles.length > 0 ? `${targetRoles.length} selected` : "None = keep all"}</span>}
          hint="Qualify by role family — none = keep all."
        >
          <div className="flex flex-wrap gap-1.5">
            {LINKEDIN_ROLE_FAMILIES.map((r) => {
              const on = targetRoles.includes(r);
              return (
                <button key={r} type="button" aria-pressed={on} onClick={() => toggleRole(r)}
                  className={cn("inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    on ? "border-brand/50 bg-brand/10 text-brand" : "border-border bg-card text-muted-foreground hover:border-brand/40 hover:text-foreground")}>
                  {on && <Check className="size-3" strokeWidth={2.25} />} {r}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="overflow-hidden rounded-xl border border-border bg-surface/40">
          <div className="flex items-start gap-2.5 border-b border-border bg-card px-3 py-2.5">
            <IconTile icon={Building2} tone="brand" size="sm" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">Company qualification</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">Applied by the opt-in &ldquo;Qualify companies&rdquo; pass (scrapes each company&rsquo;s LinkedIn page).</p>
            </div>
          </div>
          <div className="grid gap-4 p-3 sm:grid-cols-2">
            <Field label="Maximum company size">
              <Select value={String(employeeMax)} onChange={(e) => setEmployeeMax(Number(e.target.value))}>
                {EMPLOYEE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </Select>
            </Field>
            <Field label={<>Target industries <span className="font-normal text-muted-foreground">(optional)</span></>}>
              <TokenList values={targetIndustries} onChange={setTargetIndustries} placeholder="SaaS / FinTech / Logistics" />
            </Field>
          </div>
        </div>
      </div>

      <DialogFooter className="mt-5 border-t border-border pt-4">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="brand" disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Radar />} Start scrape
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

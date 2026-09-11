"use client";
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Radar, Check } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { createLinkedInSearch } from "@/lib/api/client";
import { TokenList } from "./filter-primitives";
import {
  LINKEDIN_ROLE_FAMILIES, LINKEDIN_DATE_LABEL, LINKEDIN_JOB_TYPES, LINKEDIN_JOB_TYPE_LABEL,
  type LinkedInDatePosted, type LinkedInJobType,
} from "@/lib/leads/linkedin-jobs-types";

const DATE_OPTIONS: LinkedInDatePosted[] = ["24h", "7d", "30d", "any"];
const DEPTH_OPTIONS = [
  { v: 10, l: "~100 roles (fast)" }, { v: 20, l: "~200 roles" }, { v: 30, l: "~300 roles (recommended)" },
  { v: 50, l: "~500 roles" }, { v: 100, l: "Deepest (time-capped, ~500–1,000)" },
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
  const [targetRoles, setTargetRoles] = React.useState<string[]>([]);
  const [maxPages, setMaxPages] = React.useState(30);
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
        params: { keywords, locations, datePosted, jobType, targetRoles, maxAgeDays, maxPages, employeeMax, targetIndustries },
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
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Radar className="size-5 text-primary" /> Scrape LinkedIn jobs</DialogTitle>
        <DialogDescription>Discover open technical roles from LinkedIn&rsquo;s public job search. One query runs per keyword × location.</DialogDescription>
      </DialogHeader>

      <div className="max-h-[65vh] space-y-4 overflow-y-auto scrollbar-thin py-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Keywords <span className="text-muted-foreground">(one per role search)</span></Label>
            <TokenList values={keywords} onChange={setKeywords} placeholder="e.g. Python Developer" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Locations <span className="text-muted-foreground">(optional)</span></Label>
            <TokenList values={locations} onChange={setLocations} placeholder="Singapore / Germany" />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Date posted</Label>
            <Select value={datePosted} onChange={(e) => setDatePosted(e.target.value as LinkedInDatePosted)}>
              {DATE_OPTIONS.map((d) => <option key={d} value={d}>{LINKEDIN_DATE_LABEL[d]}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Job type</Label>
            <Select value={jobType} onChange={(e) => setJobType(e.target.value as LinkedInJobType)}>
              {LINKEDIN_JOB_TYPES.map((t) => <option key={t} value={t}>{LINKEDIN_JOB_TYPE_LABEL[t]}</option>)}
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Target roles <span className="text-muted-foreground">(qualify by role family — none = keep all)</span></Label>
          <div className="flex flex-wrap gap-1.5">
            {LINKEDIN_ROLE_FAMILIES.map((r) => {
              const on = targetRoles.includes(r);
              return (
                <button key={r} type="button" onClick={() => toggleRole(r)}
                  className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors", on ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-muted")}>
                  {on && <Check className="size-3" />} {r}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Depth per query <span className="text-muted-foreground">(how far to page through results)</span></Label>
          <Select value={String(maxPages)} onChange={(e) => setMaxPages(Number(e.target.value))}>
            {DEPTH_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
        </div>

        <div className="rounded-lg border bg-muted/10 p-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Company qualification <span className="font-normal">— applied by the opt-in &ldquo;Qualify companies&rdquo; pass (scrapes each company&rsquo;s LinkedIn page).</span></p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Maximum company size</Label>
              <Select value={String(employeeMax)} onChange={(e) => setEmployeeMax(Number(e.target.value))}>
                {EMPLOYEE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Target industries <span className="text-muted-foreground">(optional)</span></Label>
              <TokenList values={targetIndustries} onChange={setTargetIndustries} placeholder="SaaS / FinTech / Logistics" />
            </div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />} Start scrape
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

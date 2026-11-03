"use client";
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Radar, Check } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconTile, Field } from "@/components/common/kit";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { createJobSearch } from "@/lib/api/client";
import { JOB_SOURCES, JOB_SOURCE_LABEL, JOB_SOURCE_REGION, type JobSource } from "@/lib/leads/job-collect-types";

export interface CrawlSeed {
  keywords: string;
  location: string;
}

/**
 * Composer for a new job-board crawl. Seeded from the current Jobs-tab filters
 * (titles → keywords, country → location) and lets the user pick which boards
 * to crawl. Crawling runs server-side through the proxy pool.
 */
export function JobCrawlDialog({
  open,
  onOpenChange,
  seed,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  seed: CrawlSeed;
  onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const [keywords, setKeywords] = React.useState(seed.keywords);
  const [location, setLocation] = React.useState(seed.location);
  const [maxPages, setMaxPages] = React.useState(3);
  const [sources, setSources] = React.useState<JobSource[]>([...JOB_SOURCES]);

  // Re-seed each time the dialog is opened from fresh filters.
  React.useEffect(() => {
    if (open) { setKeywords(seed.keywords); setLocation(seed.location); }
  }, [open, seed.keywords, seed.location]);

  const toggle = (s: JobSource) => setSources((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const create = useMutation({
    mutationFn: () =>
      createJobSearch({
        name: keywords.trim() ? `${keywords.trim()}${location.trim() ? ` · ${location.trim()}` : ""}` : "Job search",
        sources,
        keywords: keywords.trim(),
        location: location.trim(),
        maxPages,
      }),
    onSuccess: (job) => {
      toast({ variant: "success", title: "Crawl started", description: `Searching ${sources.length} source${sources.length === 1 ? "" : "s"} for “${keywords.trim()}”.` });
      onCreated(job.id);
      onOpenChange(false);
    },
    onError: (e) => toast({ variant: "error", title: "Couldn't start crawl", description: e instanceof Error ? e.message : "Try again." }),
  });

  const canSubmit = keywords.trim().length > 0 && sources.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-2xl">
      <DialogHeader>
        <IconTile icon={Radar} tone="brand" className="mb-3" />
        <DialogTitle>Crawl job boards</DialogTitle>
        <DialogDescription>Search open roles across multiple boards through your proxy pool. Every role is tagged with its source.</DialogDescription>
      </DialogHeader>

      <div className="space-y-5 py-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Keywords">
            <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="software engineer" />
          </Field>
          <Field label={<>Location <span className="font-normal text-muted-foreground">(optional)</span></>}>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Sydney / London / Remote" />
          </Field>
        </div>

        <Field
          label="Sources"
          aside={<span className="text-[11px] font-medium tabular-nums text-muted-foreground">{sources.length} / {JOB_SOURCES.length} selected</span>}
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {JOB_SOURCES.map((s) => {
              const on = sources.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggle(s)}
                  aria-pressed={on}
                  className={cn(
                    "flex min-w-0 flex-col items-start gap-0.5 rounded-xl border bg-card p-3 text-left transition-[border-color,box-shadow,background-color]",
                    on ? "border-brand ring-[3px] ring-brand/15" : "border-border hover:bg-surface",
                  )}
                >
                  <span className="flex w-full min-w-0 items-center justify-between gap-1 text-[13px] font-medium">
                    <span className="truncate">{JOB_SOURCE_LABEL[s]}</span>
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {on && <Check className="size-2.5" strokeWidth={3} />}
                    </span>
                  </span>
                  <span className="w-full truncate text-[11px] text-muted-foreground">{JOB_SOURCE_REGION[s]}</span>
                </button>
              );
            })}
          </div>
        </Field>

        <Field
          label="Pages per source"
          aside={<span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-brand">{maxPages} × ~20 roles</span>}
        >
          <div className="rounded-lg border border-border bg-surface/50 px-3 py-2.5">
            <input type="range" min={1} max={10} value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} className="w-full accent-[hsl(var(--brand))]" />
            <div className="mt-1 flex justify-between text-[10px] font-medium tabular-nums text-muted-foreground"><span>1</span><span>10</span></div>
          </div>
        </Field>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Radar />} Start crawl
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

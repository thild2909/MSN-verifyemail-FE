"use client";
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Radar, Check } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Radar className="size-5 text-primary" /> Crawl job boards</DialogTitle>
        <DialogDescription>Search open roles across multiple boards through your proxy pool. Every role is tagged with its source.</DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Keywords</Label>
            <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="software engineer" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Location <span className="text-muted-foreground">(optional)</span></Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Sydney / London / Remote" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Sources</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {JOB_SOURCES.map((s) => {
              const on = sources.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggle(s)}
                  className={cn("flex flex-col items-start gap-0.5 rounded-lg border p-2.5 text-left transition-colors", on ? "border-primary bg-primary/5" : "border-input hover:bg-muted")}
                >
                  <span className="flex w-full items-center justify-between text-sm font-medium">
                    {JOB_SOURCE_LABEL[s]}
                    {on && <Check className="size-3.5 text-primary" />}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{JOB_SOURCE_REGION[s]}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Pages per source <span className="text-muted-foreground">({maxPages} × ~20 roles)</span></Label>
          <input type="range" min={1} max={10} value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} className="w-full accent-[hsl(var(--primary))]" />
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />} Start crawl
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

"use client";
import { X, Bookmark, ListPlus, BadgeCheck, MailSearch, Workflow, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/utils";

export type BulkAction = "save" | "add_list" | "verify_emails" | "find_emails" | "add_workflow" | "export";

export function BulkActionBar({
  count, onAction, onClear,
}: {
  count: number;
  onAction: (action: BulkAction) => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-2 rounded-xl border bg-card/95 p-2 pl-4 shadow-2xl backdrop-blur">
        <span className="flex items-center gap-2 pr-1 text-sm font-semibold">
          <span className="rounded-md bg-primary px-2 py-0.5 text-primary-foreground tabular-nums">{formatNumber(count)}</span>
          selected
        </span>
        <div className="h-6 w-px bg-border" />
        <Button size="sm" variant="ghost" onClick={() => onAction("save")}><Bookmark className="size-4" /> Save</Button>
        <Button size="sm" variant="ghost" onClick={() => onAction("add_list")}><ListPlus className="size-4" /> Add to list</Button>
        <Button size="sm" variant="ghost" onClick={() => onAction("verify_emails")}><BadgeCheck className="size-4" /> Verify emails</Button>
        <Button size="sm" variant="ghost" onClick={() => onAction("find_emails")}><MailSearch className="size-4" /> Find emails</Button>
        <Button size="sm" variant="ghost" onClick={() => onAction("add_workflow")}><Workflow className="size-4" /> Workflow</Button>
        <Button size="sm" variant="outline" onClick={() => onAction("export")}><Download className="size-4" /> Export</Button>
        <button onClick={onClear} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Clear selection">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

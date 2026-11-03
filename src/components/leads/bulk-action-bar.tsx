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
      <div className="pointer-events-auto flex max-w-full animate-fade-in flex-wrap items-center justify-center gap-1 rounded-xl border border-border bg-card p-1.5 pl-3 shadow-pop">
        <span className="flex items-center gap-2 pr-2 text-[13px] font-medium text-foreground">
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums">
            {formatNumber(count)}
          </span>
          selected
        </span>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button size="sm" variant="ghost" onClick={() => onAction("save")}><Bookmark /> Save</Button>
        <Button size="sm" variant="ghost" onClick={() => onAction("add_list")}><ListPlus /> Add to list</Button>
        <Button size="sm" variant="ghost" onClick={() => onAction("verify_emails")}><BadgeCheck /> Verify emails</Button>
        <Button size="sm" variant="ghost" onClick={() => onAction("find_emails")}><MailSearch /> Find emails</Button>
        <Button size="sm" variant="ghost" onClick={() => onAction("add_workflow")}><Workflow /> Workflow</Button>
        <Button size="sm" variant="outline" onClick={() => onAction("export")}><Download /> Export</Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <button
          onClick={onClear}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          aria-label="Clear selection"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

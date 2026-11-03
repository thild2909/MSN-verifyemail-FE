"use client";
import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Dark code panel with a title bar (language / caption) and a copy button. */
export function CodeBlock({ code, lang = "json", title, className }: { code: string; lang?: string; title?: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-[hsl(229_22%_9%)]", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5">
        <span className="flex items-center gap-2 text-[11px] font-medium text-[hsl(225_15%_70%)]">
          <span className="flex gap-1" aria-hidden>
            <span className="size-2 rounded-full bg-white/15" />
            <span className="size-2 rounded-full bg-white/15" />
            <span className="size-2 rounded-full bg-white/15" />
          </span>
          {title ?? lang.toUpperCase()}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[hsl(225_15%_70%)] transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3.5 text-[hsl(152_55%_55%)]" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="scrollbar-thin overflow-x-auto p-4 text-xs leading-relaxed text-[hsl(225_20%_88%)]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

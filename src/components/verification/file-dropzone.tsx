"use client";
import * as React from "react";
import { UploadCloud, FileSpreadsheet, FileText, FileType } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { UPLOAD_LIMITS } from "@/lib/credit-config";

const FORMAT_ICON: Record<string, React.ElementType> = { CSV: FileSpreadsheet, XLSX: FileSpreadsheet, TXT: FileText };

/** Drag-and-drop / click-to-browse file target (shared by Verification and Lead imports). */
export function FileDropzone({ onFile, compact }: { onFile: (file: File) => void; compact?: boolean }) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (files && files[0]) onFile(files[0]);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label="Upload a file"
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
      className={cn(
        "group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed text-center outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/20",
        compact ? "px-5 py-7" : "px-6 py-10",
        dragging ? "border-brand bg-brand/[0.06]" : "border-border bg-surface/40 hover:border-brand/50 hover:bg-brand/[0.03]",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.txt,text/csv,text/plain"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <span
        className={cn(
          "mb-3 flex size-12 items-center justify-center rounded-xl border border-border bg-card text-brand shadow-xs transition-transform",
          dragging ? "-translate-y-0.5 scale-105" : "group-hover:-translate-y-0.5",
        )}
      >
        <UploadCloud className="size-6" strokeWidth={1.75} />
      </span>
      <p className="text-[15px] font-semibold">{dragging ? "Drop to upload" : "Drop your file here"}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        or <span className="font-medium text-brand underline-offset-2 group-hover:underline">browse your computer</span>
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        {UPLOAD_LIMITS.supportedFormats.map((f) => {
          const Icon = FORMAT_ICON[f] ?? FileType;
          return (
            <span key={f} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 font-medium">
              <Icon className="size-3 text-[hsl(var(--valid))]" strokeWidth={1.9} />
              {f}
            </span>
          );
        })}
        <span className="ml-1">Up to {UPLOAD_LIMITS.maxFileSizeMb} MB · {formatNumber(UPLOAD_LIMITS.maxRows)} rows</span>
      </div>
    </div>
  );
}

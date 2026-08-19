"use client";
import * as React from "react";
import { UploadCloud, FileText } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { UPLOAD_LIMITS } from "@/lib/credit-config";

export function FileDropzone({ onFile }: { onFile: (file: File) => void }) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (files && files[0]) onFile(files[0]);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/40",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.txt,text/csv,text/plain"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <UploadCloud className="size-7" />
      </div>
      <p className="text-base font-semibold">Drag &amp; drop a file here</p>
      <p className="mt-1 text-sm text-muted-foreground">
        or <span className="font-medium text-primary">browse files</span>
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
        {UPLOAD_LIMITS.supportedFormats.map((f) => (
          <span key={f} className="inline-flex items-center gap-1 rounded-md bg-card px-2 py-1 shadow-sm">
            <FileText className="size-3" />
            {f}
          </span>
        ))}
        <span>· up to {UPLOAD_LIMITS.maxFileSizeMb}MB · {formatNumber(UPLOAD_LIMITS.maxRows)} rows</span>
      </div>
    </div>
  );
}

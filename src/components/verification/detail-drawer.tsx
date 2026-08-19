"use client";
import { RefreshCw, Plus, Sparkles } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./status-badge";
import { ResultDetails } from "./result-details";
import { ScoreRing, scoreTone } from "@/components/common/score-ring";
import { formatDateTime } from "@/lib/utils";
import type { EmailRecord } from "@/lib/types";

export function DetailDrawer({
  record,
  open,
  onOpenChange,
  onDeepScan,
  deepScanning,
}: {
  record: EmailRecord | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDeepScan?: (record: EmailRecord) => void;
  deepScanning?: boolean;
}) {
  const result = record?.result;
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {record && result && (
        <div className="p-6">
          <p className="pr-8 text-sm font-medium text-muted-foreground">Verification detail</p>
          <h2 className="mt-1 break-all text-lg font-semibold">{record.email}</h2>

          <div className="mt-4 flex items-center gap-4 rounded-xl border bg-muted/20 p-4">
            <ScoreRing score={result.score} tone={scoreTone(result.score)} />
            <div>
              <StatusBadge status={result.status} />
              <p className="mt-2 text-sm text-muted-foreground">{result.suggestedAction}</p>
            </div>
          </div>

          {(record.firstName || record.company) && (
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              {record.firstName && <Field label="Name" value={`${record.firstName} ${record.lastName ?? ""}`.trim()} />}
              {record.jobTitle && <Field label="Title" value={record.jobTitle} />}
              {record.company && <Field label="Company" value={record.company} />}
              <Field label="Domain" value={result.domain} />
            </div>
          )}

          <div className="mt-5">
            <ResultDetails result={result} />
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            Verified {formatDateTime(result.verifiedAt)}
            {result.deepScanned ? " · Deep scanned" : ""}
          </p>

          <div className="mt-5 flex gap-2">
            {!result.deepScanned && onDeepScan && (
              <Button className="flex-1" variant="outline" disabled={deepScanning} onClick={() => onDeepScan(record)}>
                {deepScanning ? <RefreshCw className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Deep Scan
              </Button>
            )}
            <Button className="flex-1" variant="outline">
              <RefreshCw className="size-4" /> Reverify
            </Button>
            <Button className="flex-1">
              <Plus className="size-4" /> Add to list
            </Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}

"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ShieldCheck, ShieldAlert, ShieldX, Globe, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { getListRecords, listExportUrl } from "@/lib/api/client";
import { formatNumber } from "@/lib/utils";
import type { EmailList } from "@/lib/types";

/** Trigger a browser download without navigating away. */
function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Download menu for a verification list. Offers three cleaned-list options with
 * live counts; each exports the ORIGINAL columns + filename plus the verification
 * result columns, filtered to the chosen deliverability set.
 *
 *   Safe to send            → valid only               (recommended)
 *   Safe to send + Ok for All → valid + catch-all (accept-all)
 *   Catch-all               → catch-all (accept-all) only
 *   Invalid                 → invalid / risky / unknown (not valid, not catch-all)
 *   All emails              → everything
 */
export function DownloadMenu({
  list,
  trigger,
  align = "end",
}: {
  list: EmailList;
  /** Custom trigger (e.g. a compact button in a table row). Defaults to a full button. */
  trigger?: React.ReactNode;
  align?: "start" | "end";
}) {
  // catch-all ("Ok for All") isn't broken out in the summary buckets (it rolls
  // into "risky"), so fetch its exact count — but only once the menu is opened,
  // so a table of many rows doesn't fire a query per row. pageSize:1 → just `total`.
  const [armed, setArmed] = React.useState(false);
  const { data: catchAll } = useQuery({
    queryKey: ["records", list.id, "catch_all-count", list.summary.risky],
    queryFn: () => getListRecords(list.id, { status: "catch_all", pageSize: 1 }),
    enabled: armed,
  });

  const safe = list.summary.valid;
  const okForAll = catchAll?.total ?? 0;
  const safeOk = safe + okForAll;
  const all = list.summary.total;
  // Everything that isn't valid and isn't catch-all: invalid / risky / unknown / …
  const invalid = Math.max(0, all - safe - okForAll);

  // Preserve the imported file's type (csv/xlsx) so the download matches the upload.
  const format: "csv" | "xlsx" = /\.xlsx?$/i.test(list.fileName) ? "xlsx" : "csv";

  const triggerNode = trigger ?? (
    <Button>
      <Download className="size-4" /> Download
    </Button>
  );

  return (
    <DropdownMenu
      align={align}
      className="w-72"
      trigger={<span onClick={() => setArmed(true)}>{triggerNode}</span>}
    >
      <p className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">Download cleaned list</p>

      <DownloadOption
        icon={<ShieldCheck />}
        label="Safe to send"
        count={safe}
        recommended
        onClick={() => download(listExportUrl(list.id, format, "safe"))}
      />
      <DownloadOption
        icon={<ShieldAlert />}
        label="Safe to send + Ok for All"
        count={safeOk}
        onClick={() => download(listExportUrl(list.id, format, "safe_ok"))}
      />
      <DownloadOption
        icon={<Globe />}
        label="Catch-all"
        count={okForAll}
        onClick={() => download(listExportUrl(list.id, format, "catch_all"))}
      />
      <DownloadOption
        icon={<ShieldX />}
        label="Invalid"
        count={invalid}
        onClick={() => download(listExportUrl(list.id, format, "unsafe"))}
      />
      <DropdownSeparator />
      <DownloadOption
        icon={<Database />}
        label="All emails"
        count={all}
        onClick={() => download(listExportUrl(list.id, format, "all"))}
      />
    </DropdownMenu>
  );
}

function DownloadOption({
  icon,
  label,
  count,
  recommended,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  recommended?: boolean;
  onClick: () => void;
}) {
  return (
    <DropdownItem className="items-start py-2.5" onClick={onClick}>
      <span className="mt-0.5">{icon}</span>
      <span className="flex-1">
        <span className="flex items-center gap-2">
          <span className="font-medium text-foreground">{label}</span>
          {recommended && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              Recommended
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{formatNumber(count)} emails</span>
      </span>
    </DropdownItem>
  );
}

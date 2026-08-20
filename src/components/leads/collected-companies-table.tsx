"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Inbox, Loader2, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { getCollectedCompanies } from "@/lib/api/client";
import { formatNumber, cn } from "@/lib/utils";
import { Sourced, COLLECT_STATUS_META } from "./collect-ui";
import type { CollectedCompany } from "@/lib/leads/collect-types";

const PAGE_SIZE = 25;

export function CollectedCompaniesTable({ jobId, live, onOpenCompany }: { jobId: string; live: boolean; onOpenCompany: (c: CollectedCompany) => void }) {
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);
  React.useEffect(() => { setPage(1); }, [debounced, filter]);

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["collect-companies", jobId, debounced, filter, page],
    queryFn: () => getCollectedCompanies(jobId, { search: debounced, filter, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
    refetchInterval: live ? 1500 : false,
  });

  const rows = data?.companies ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company or location…" className="h-9 pl-9" />
        </div>
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 w-40">
          <option value="all">All companies</option>
          <option value="enriched">Enriched</option>
          <option value="has_email">Has email</option>
          <option value="has_phone">Has phone</option>
          <option value="not_found">Not found</option>
        </Select>
        <span className="text-sm text-muted-foreground"><span className="font-semibold text-foreground tabular-nums">{formatNumber(total)}</span> companies</span>
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : total === 0 ? (
          <EmptyState icon={Inbox} title="No companies match" description="Try clearing the search or filter." className="m-6" />
        ) : (
          <div className={cn("scrollbar-thin h-full overflow-auto transition-opacity", isPlaceholderData && "opacity-60")}>
            <table className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">Company</th>
                  <th className="px-3 py-2.5 font-medium">Website</th>
                  <th className="px-3 py-2.5 font-medium">Email</th>
                  <th className="px-3 py-2.5 font-medium">Phone</th>
                  <th className="px-3 py-2.5 font-medium">LinkedIn</th>
                  <th className="px-3 py-2.5 font-medium">Industry</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const st = COLLECT_STATUS_META[c.status];
                  const emailField = c.contactEmail ?? c.emailDomain;
                  return (
                    <tr key={c.id} onClick={() => onOpenCompany(c)} className="cursor-pointer border-b hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[11px] font-bold text-primary">{c.logoText || c.inputName.slice(0, 2).toUpperCase()}</span>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{c.inputName}</p>
                            <p className="truncate text-xs text-muted-foreground">{c.inputLocation}{c.domainGuess ? ` · ${c.domainGuess}` : ""}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2"><Sourced field={c.website} /></td>
                      <td className="px-3 py-2"><Sourced field={emailField} /></td>
                      <td className="px-3 py-2"><Sourced field={c.phone} /></td>
                      <td className="px-3 py-2"><Sourced field={c.linkedin} /></td>
                      <td className="px-3 py-2"><Sourced field={c.industry} /></td>
                      <td className="px-3 py-2">
                        {c.status === "collecting"
                          ? <span className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--risky))]"><Loader2 className="size-3 animate-spin" /> Collecting</span>
                          : <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", st.className)}>{st.label}</span>}
                      </td>
                      <td className="px-2 py-2 text-right"><ChevronRight className="size-4 text-muted-foreground" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
          <span>{formatNumber(total)} companies</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
            <span className="tabular-nums">Page {page} / {totalPages}</span>
            <Button size="sm" variant="outline" className="h-8" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

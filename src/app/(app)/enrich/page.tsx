"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, Plus, Table2 } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { EnrichJobsTable } from "@/components/enrich/enrich-jobs-table";
import { ImportFlow } from "@/components/enrich/import-flow";
import { getEnrichTables } from "@/lib/api/client";
import type { EnrichmentTable } from "@/lib/types";

type Sort = "newest" | "oldest" | "rows" | "emails";

export default function EnrichPage() {
  const router = useRouter();
  const [mode, setMode] = React.useState<"list" | "new">("list");
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [sort, setSort] = React.useState<Sort>("newest");

  const { data, isLoading } = useQuery({
    queryKey: ["enrich-tables"],
    queryFn: getEnrichTables,
    refetchInterval: (q) => (q.state.data as EnrichmentTable[] | undefined)?.some((t) => t.status === "enriching" || t.status === "queued") ? 2500 : false,
  });

  const filtered = React.useMemo(() => {
    let out = (data ?? []).filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));
    if (statusFilter !== "all") out = out.filter((t) => t.status === statusFilter);
    out = [...out].sort((a, b) => {
      switch (sort) {
        case "oldest": return +new Date(a.createdAt) - +new Date(b.createdAt);
        case "rows": return b.summary.rows - a.summary.rows;
        case "emails": return b.summary.emailsFound - a.summary.emailsFound;
        default: return +new Date(b.createdAt) - +new Date(a.createdAt);
      }
    });
    return out;
  }, [data, search, statusFilter, sort]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Enrichment"
        subtitle="Import a list of people or companies, then run enrichment columns (email, phone, company data, AI) — Clay/Apollo-style."
        actions={mode === "list" ? <Button onClick={() => setMode("new")}><Plus className="size-4" /> New table</Button> : null}
      />

      {mode === "new" ? (
        <ImportFlow onCreated={(id) => router.push(`/enrich/${id}`)} onCancel={() => setMode("list")} />
      ) : (
        <>
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by table name…" className="pl-9" />
                </div>
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="lg:w-44">
                  <option value="all">All statuses</option>
                  <option value="completed">Completed</option>
                  <option value="enriching">Enriching</option>
                  <option value="queued">Queued</option>
                  <option value="failed">Failed</option>
                </Select>
                <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="lg:w-44">
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="rows">Most rows</option>
                  <option value="emails">Most emails</option>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-2 sm:p-4">
              {isLoading ? (
                <div className="space-y-2 p-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : filtered.length ? (
                <EnrichJobsTable tables={filtered} />
              ) : (
                <EmptyState
                  icon={Table2}
                  title={data?.length ? "No tables match" : "No enrichment tables yet"}
                  description={data?.length ? "Try a different search or status filter." : "Import a CSV of people or companies to start enriching — find & verify emails, phones, company data and more."}
                  action={<Button onClick={() => setMode("new")}><Plus className="size-4" /> New table</Button>}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

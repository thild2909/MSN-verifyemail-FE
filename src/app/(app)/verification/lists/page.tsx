"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Search, Upload, Inbox } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { ListsTable } from "@/components/verification/lists-table";
import { getLists } from "@/lib/api/client";
import { safeToSendRate } from "@/lib/types";

type Sort = "newest" | "oldest" | "emails" | "safe";

export default function ListsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["lists"],
    queryFn: getLists,
    refetchInterval: (q) =>
      (q.state.data as { status: string }[] | undefined)?.some((l) => l.status === "processing" || l.status === "queued") ? 3000 : false,
  });
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [sort, setSort] = React.useState<Sort>("newest");

  const filtered = React.useMemo(() => {
    let out = (data ?? []).filter((l) => l.name.toLowerCase().includes(search.toLowerCase()));
    if (statusFilter !== "all") out = out.filter((l) => l.status === statusFilter);
    out = [...out].sort((a, b) => {
      switch (sort) {
        case "oldest": return +new Date(a.createdAt) - +new Date(b.createdAt);
        case "emails": return b.uniqueEmails - a.uniqueEmails;
        case "safe": return safeToSendRate(b.summary) - safeToSendRate(a.summary);
        default: return +new Date(b.createdAt) - +new Date(a.createdAt);
      }
    });
    return out;
  }, [data, search, statusFilter, sort]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lists Uploaded"
        subtitle="Search, filter, and manage every list you've verified."
        actions={
          <Link href="/verification" className={buttonVariants()}>
            <Upload className="size-4" /> Upload list
          </Link>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by filename…" className="pl-9" />
            </div>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="lg:w-44">
              <option value="all">All statuses</option>
              <option value="completed">Completed</option>
              <option value="processing">Processing</option>
              <option value="queued">Queued</option>
              <option value="failed">Failed</option>
            </Select>
            <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="lg:w-44">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="emails">Most emails</option>
              <option value="safe">Safe-to-send %</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-2 sm:p-4">
          {isLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length ? (
            <ListsTable lists={filtered} />
          ) : (
            <EmptyState
              icon={Inbox}
              title="No lists found"
              description="Try a different search, or upload a new list to get started."
              action={<Link href="/verification" className={buttonVariants()}><Upload className="size-4" /> Upload list</Link>}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

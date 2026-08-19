"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ListChecks, ArrowUpRight, Inbox } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { UploadFlow } from "@/components/verification/upload-flow";
import { ListsTable } from "@/components/verification/lists-table";
import { SingleVerifyCard } from "@/components/verification/single-verify-card";
import { getLists } from "@/lib/api/client";

function ListsSection() {
  const { data, isLoading } = useQuery({
    queryKey: ["lists"],
    queryFn: getLists,
    refetchInterval: (q) =>
      (q.state.data as { status: string }[] | undefined)?.some((l) => l.status === "processing" || l.status === "queued") ? 3000 : false,
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="size-5 text-primary" /> Lists Uploaded
          </CardTitle>
          <CardDescription>Every list you&apos;ve verified, with safe-to-send rates.</CardDescription>
        </div>
        <Link href="/verification/lists" className={buttonVariants({ variant: "outline", size: "sm" })}>
          View all
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : data && data.length ? (
          <ListsTable lists={data} />
        ) : (
          <EmptyState
            icon={Inbox}
            title="No email lists yet"
            description="Upload your first list to start verifying emails."
          />
        )}
      </CardContent>
    </Card>
  );
}

export default function VerificationPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Email Verification"
        subtitle="Verify email addresses, clean your lists, and improve email deliverability."
        actions={
          <Link href="/verification/single" className={buttonVariants({ variant: "outline" })}>
            Single check <ArrowUpRight className="size-4" />
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Upload your list to verify</CardTitle>
              <CardDescription>CSV, XLSX, or TXT. We auto-detect the email column and remove duplicates.</CardDescription>
            </CardHeader>
            <CardContent>
              <UploadFlow />
            </CardContent>
          </Card>

          <ListsSection />
        </div>

        {/* Right panel */}
        <div className="space-y-6">
          <SingleVerifyCard />
        </div>
      </div>
    </div>
  );
}

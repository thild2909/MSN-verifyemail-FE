import { Suspense } from "react";
import { FindLeads } from "@/components/leads/find-leads";

export const metadata = { title: "Find Leads" };

export default function FindLeadsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading Find Leads…</div>}>
      <FindLeads />
    </Suspense>
  );
}

"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LeadsTabs } from "./leads-tabs";
import { CompaniesTab } from "./companies-tab";
import { PeopleTab } from "./people-tab";
import { JobsTab } from "./jobs-tab";
import type { LeadsTab } from "@/lib/leads/types";

const TAB_TITLE: Record<LeadsTab, string> = { people: "Find people", companies: "Find companies", jobs: "Find jobs" };
const TAB_SUB: Record<LeadsTab, string> = {
  people: "Founders, co-founders and C-level — crawled from the public web with a verifiable work email.",
  companies: "Resolve companies to real website, email, LinkedIn and firmographics from multiple sources.",
  jobs: "Track hiring signals and open roles.",
};

/**
 * Find Leads shell. Each tab (People / Companies / Jobs) is self-contained and
 * owns its own data + toolbar. People and Companies are backed by the real
 * crawler-service; "Find people" on Companies creates a people-collect job and
 * navigates here to the People tab.
 */
export function FindLeads() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = React.useState<LeadsTab>(() => (searchParams.get("tab") as LeadsTab) || "people");
  const [peopleJobId, setPeopleJobId] = React.useState<string | null>(() => searchParams.get("pj"));

  // Persist tab + active people job to the URL (shareable, restores on reload).
  React.useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== "people") params.set("tab", tab);
    if (peopleJobId) params.set("pj", peopleJobId);
    const qs = params.toString();
    router.replace(qs ? `/find-leads?${qs}` : "/find-leads", { scroll: false });
  }, [tab, peopleJobId, router]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="space-y-2 border-b px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Find Leads</span>
          <LeadsTabs active={tab} onChange={setTab} />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight">{TAB_TITLE[tab]}</h1>
          <p className="text-sm text-muted-foreground">{TAB_SUB[tab]}</p>
        </div>
      </div>

      {/* Body */}
      {tab === "people" ? (
        <PeopleTab initialJobId={peopleJobId} />
      ) : tab === "companies" ? (
        <CompaniesTab onNavigatePeople={(jobId) => { setPeopleJobId(jobId); setTab("people"); }} />
      ) : (
        <JobsTab filtersVisible search="" />
      )}
    </div>
  );
}

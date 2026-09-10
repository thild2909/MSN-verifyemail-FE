"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LeadsTabs } from "./leads-tabs";
import { CompaniesTab } from "./companies-tab";
import { PeopleTab } from "./people-tab";
import { JobsTab } from "./jobs-tab";
import { FindWithAiTab } from "./find-with-ai-tab";
import type { LeadsTab } from "@/lib/leads/types";

const TAB_TITLE: Record<LeadsTab, string> = { people: "Find people", companies: "Find companies", jobs: "Find jobs", ai: "Find with AI" };
const TAB_SUB: Record<LeadsTab, string> = {
  people: "Find founders and C-level with a verified work email.",
  companies: "Get each company's website, email, LinkedIn and key details.",
  jobs: "Track who is hiring and their open roles.",
  ai: "Tell the AI what companies you are looking for. It searches the web and gives you a ranked list of matching companies. You can also upload a brief to guide the search.",
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
      <div className="space-y-2 border-b px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="hidden text-xs font-bold uppercase tracking-widest text-muted-foreground sm:inline">Find Leads</span>
          <LeadsTabs active={tab} onChange={setTab} />
        </div>
        <div>
          <h1 className="text-base font-bold tracking-tight sm:text-lg">{TAB_TITLE[tab]}</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">{TAB_SUB[tab]}</p>
        </div>
      </div>

      {/* Body */}
      {tab === "people" ? (
        <PeopleTab initialJobId={peopleJobId} />
      ) : tab === "companies" ? (
        <CompaniesTab onNavigatePeople={(jobId) => { setPeopleJobId(jobId); setTab("people"); }} />
      ) : tab === "jobs" ? (
        <JobsTab onNavigatePeople={(jobId) => { setPeopleJobId(jobId); setTab("people"); }} />
      ) : (
        <FindWithAiTab />
      )}
    </div>
  );
}

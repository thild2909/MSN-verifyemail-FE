"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LeadsTabs } from "./leads-tabs";
import { CompaniesTab } from "./companies-tab";
import { PeopleTab } from "./people-tab";
import { JobsTab } from "./jobs-tab";
import { LinkedInJobsTab } from "./linkedin-jobs-tab";
import { FindWithAiTab } from "./find-with-ai-tab";
import type { LeadsTab } from "@/lib/leads/types";

const TAB_TITLE: Record<LeadsTab, string> = { people: "Find people", companies: "Find companies", jobs: "Find jobs", linkedin: "Scrape LinkedIn jobs", ai: "Find with AI" };
const TAB_SUB: Record<LeadsTab, string> = {
  people: "Find founders and C-level with a verified work email.",
  companies: "Get each company's website, email, LinkedIn and key details.",
  jobs: "Track who is hiring and their open roles.",
  linkedin: "Discover open technical roles on LinkedIn, then qualify the hiring companies by size & industry.",
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
      {/* Header — compact on mobile: just the tab rail (the title/subtitle,
          redundant with the active tab, show from sm up to save vertical space). */}
      <div className="border-b border-border bg-card px-4 pt-2 sm:px-6 sm:pt-5">
        <div className="mb-3 hidden sm:block">
          <p className="text-xs font-medium text-muted-foreground">Find leads</p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight">{TAB_TITLE[tab]}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{TAB_SUB[tab]}</p>
        </div>
        <LeadsTabs active={tab} onChange={setTab} />
      </div>

      {/* Body */}
      {tab === "people" ? (
        <PeopleTab initialJobId={peopleJobId} />
      ) : tab === "companies" ? (
        <CompaniesTab onNavigatePeople={(jobId) => { setPeopleJobId(jobId); setTab("people"); }} />
      ) : tab === "jobs" ? (
        <JobsTab onNavigatePeople={(jobId) => { setPeopleJobId(jobId); setTab("people"); }} />
      ) : tab === "linkedin" ? (
        <LinkedInJobsTab onNavigatePeople={(jobId) => { setPeopleJobId(jobId); setTab("people"); }} />
      ) : (
        <FindWithAiTab />
      )}
    </div>
  );
}

/**
 * Background runner for company collection. Delegates the REAL work to the
 * standalone crawler-service (resolve → crawl → cross-verify → score); no mock
 * data is produced here. Concurrency is kept modest because each company is a
 * live multi-source collection in the service.
 */
import "server-only";
import { resolveViaCrawler } from "./crawler-client";
import * as store from "./company-collect-store";

const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CRAWLER_CONCURRENCY ?? 4), 12));
const running = new Set<string>();

export function startCollectJob(id: string) {
  if (running.has(id)) return;
  running.add(id);
  void run(id).finally(() => running.delete(id));
}
export function isCollectRunning(id: string) {
  return running.has(id);
}

async function run(id: string) {
  const companies = store.rawCompanies(id).filter((c) => c.status === "pending");
  let next = 0;

  async function worker() {
    while (next < companies.length) {
      const c = companies[next++];
      store.setCompanyCollecting(id, c.id);
      try {
        const company = await resolveViaCrawler(c.inputName, c.inputLocation);
        store.applyCompany(id, c.id, company);
      } catch {
        store.applyCompany(id, c.id, { ...blankFailed(c.inputName, c.inputLocation) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, companies.length || 1) }, () => worker()));

  // NOTE: email verification is NOT run automatically — it is an opt-in step the
  // user triggers with the "Verify emails" button.
  store.finalizeCollectJob(id);
}

function blankFailed(name: string, location: string) {
  return {
    inputName: name, inputLocation: location, domainGuess: "", logoText: "", status: "failed" as const,
    resolution: null,
    website: null, emailDomain: null, contactEmail: null, phone: null, linkedin: null, twitter: null, facebook: null,
    address: null, mapsRating: null, industry: null, employees: null, revenue: null, founded: null, description: null,
    technologies: null, legalName: null, jurisdiction: null, registrationNumber: null, incorporated: null,
    emailVerification: null, collection: [],
  };
}

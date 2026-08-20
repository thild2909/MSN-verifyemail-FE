/**
 * Background runner for company multi-source collection. One ProxyRotator is
 * shared across the whole job so IP rotation is continuous; concurrency comes
 * from the saved ProxyConfig. A small real delay per company animates progress.
 */
import "server-only";
import { sleep } from "@/lib/utils";
import { collectCompany, ProxyRotator } from "./company-collector";
import { getProxyConfigInternal } from "./proxy-store";
import * as store from "./company-collect-store";

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
  const cfg = getProxyConfigInternal();
  const rotator = new ProxyRotator(cfg);
  const companies = store.rawCompanies(id).filter((c) => c.status === "pending");
  const concurrency = Math.max(1, Math.min(cfg.concurrency ?? 3, 8));
  let next = 0;

  async function worker() {
    while (next < companies.length) {
      const c = companies[next++];
      store.setCompanyCollecting(id, c.id);
      await sleep(60 + Math.floor(Math.random() * 120)); // brief animate before the real fetch
      try {
        const { company } = await collectCompany(c.inputName, c.inputLocation, cfg, rotator);
        store.applyCompany(id, c.id, company);
      } catch {
        store.applyCompany(id, c.id, { ...blankFailed(c.inputName, c.inputLocation) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, companies.length || 1) }, () => worker()));
  store.finalizeCollectJob(id);
}

function blankFailed(name: string, location: string) {
  return {
    inputName: name, inputLocation: location, domainGuess: "", logoText: "", status: "failed" as const,
    website: null, emailDomain: null, contactEmail: null, phone: null, linkedin: null, twitter: null, facebook: null,
    address: null, mapsRating: null, industry: null, employees: null, revenue: null, founded: null, description: null,
    technologies: null, collection: [],
  };
}

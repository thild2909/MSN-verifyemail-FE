/**
 * Background runner for people collection ("Find people"). Delegates the REAL
 * work to the standalone crawler-service (X-ray on linkedin.com/in → parse →
 * classify → company-match → rank). Each seed company yields its decision-makers.
 * No mock data. Email verification is NOT automatic — opt-in via "Verify emails".
 */
import "server-only";
import { resolvePeopleViaCrawler, resolvePersonViaCrawler, resolveCompanyWebsiteViaCrawler, crawlerProxyAvailable, type CrawledPerson } from "./crawler-client";
import type { PeopleSeedInput } from "@/lib/leads/people-types";
import * as store from "./people-collect-store";

/**
 * A CSV-imported row is COMPLETE when it already carries the person's own
 * enriched data — a LinkedIn, an email, or a Title/Seniority (the role). The
 * enrich crawl only exists to FIND those; if the CSV already has them, we skip
 * the (slow) crawl and show the imported data immediately (title, seniority,
 * LinkedIn, location, company phone/email/employees/industry). The user's words:
 * "đã map đủ thông tin … thì không cần crawl nữa mà show trực tiếp lên UI".
 */
function seedIsComplete(seed: PeopleSeedInput): boolean {
  const has = (v?: string | null) => !!(v && v.trim());
  return has(seed.personLinkedin) || has(seed.email) || has(seed.title) || has(seed.seniority);
}

const domainOf = (website?: string | null): string | null => {
  if (!website) return null;
  const h = website.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").trim().toLowerCase();
  return h && h.includes(".") ? h : null;
};

/** Build a person row straight from the imported seed (no crawl). Fields are
 *  left null so `applySeedPeople` fills them from the seed (title/LinkedIn/…). */
function personFromSeed(seed: PeopleSeedInput): CrawledPerson {
  return {
    company: seed.company,
    companyDomain: domainOf(seed.website) ?? seed.domain ?? null,
    name: `${seed.firstName ?? ""} ${seed.lastName ?? ""}`.trim(),
    firstName: seed.firstName ?? "",
    lastName: seed.lastName ?? "",
    title: null,
    seniority: "other",
    linkedin: null,
    email: null,
    emailKind: "none",
    location: seed.location || null,
    confidence: 80,
    emailVerification: null,
    collection: [{ source: "other", status: "ok", proxy: null, ms: 0, fieldsFound: 1, detail: "imported, already complete, not enriched", provider: "import" }],
  };
}

/**
 * Fill an EMPTY Website on an imported row via the crawler's website-only
 * resolution (same tiered SERP logic as the Companies flow, Decodo first).
 * Memoized per company+location so many people at one company cost ONE SERP
 * resolution; failures resolve to null (the row still shows, without a domain).
 */
const websiteMemo = new Map<string, Promise<{ domain: string; provider: string } | null>>();
function resolveWebsiteMemo(company: string, location: string): Promise<{ domain: string; provider: string } | null> {
  const key = `${company.toLowerCase().trim()}|${location.toLowerCase().trim()}`;
  let p = websiteMemo.get(key);
  if (!p) {
    if (websiteMemo.size > 1000) websiteMemo.clear();
    p = resolveCompanyWebsiteViaCrawler(company, location)
      .then((r) => (r.domain ? { domain: r.domain, provider: r.provider || "crawler" } : null))
      .catch(() => null);
    websiteMemo.set(key, p);
  }
  return p;
}

const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CRAWLER_PEOPLE_CONCURRENCY ?? process.env.CRAWLER_CONCURRENCY ?? 3), 12));
// Block-retry: seeds that came back rate-limited (blocked, nothing found) are
// recoverable — re-run them after a backoff at low concurrency so a transient
// Brave rate-limit doesn't leave a person without their LinkedIn/title.
const RETRY_PASSES = Math.max(0, Number(process.env.CRAWLER_PEOPLE_RETRY_PASSES ?? 4));
const RETRY_BACKOFF_MS = Math.max(2000, Number(process.env.CRAWLER_PEOPLE_RETRY_BACKOFF_MS ?? 15_000));
const RETRY_CONCURRENCY = Math.max(1, Number(process.env.CRAWLER_PEOPLE_RETRY_CONCURRENCY ?? 2));
// Hard ceiling on the WHOLE block-retry phase. Even when a proxy is present, this
// caps the futile tail so the job can never sit "almost done" for many minutes.
const RETRY_PHASE_BUDGET_MS = Math.max(30_000, Number(process.env.CRAWLER_PEOPLE_RETRY_BUDGET_MS ?? 120_000));
const running = new Set<string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startPeopleJob(id: string) {
  if (running.has(id)) return;
  running.add(id);
  void run(id).finally(() => running.delete(id));
}
export function isPeopleJobRunning(id: string) {
  return running.has(id);
}

async function run(id: string) {
  const seeds = store.rawSeeds(id);
  const indexes = store.pendingSeedIndexes(id);
  // Seeds whose only failure was a rate-limit block — candidates for a retry pass.
  const blocked = new Set<number>();

  async function processIndex(index: number) {
    const seed = seeds[index];
    store.setSeedCollecting(id, index);
    try {
      const isPerson = !!(seed.firstName || seed.lastName);
      if (seed.prefill) {
        // Matched a saved-list snapshot on import → show it as-is, no crawl.
        store.applyPrefillPerson(id, index, seed.prefill);
        blocked.delete(index);
      } else if (isPerson && seedIsComplete(seed)) {
        // Already has LinkedIn/email from the CSV → show as-is, skip enrichment.
        // An EMPTY Website is still filled: resolve it with the company-flow
        // SERP crawl (Decodo real-Google first) so the row carries its domain.
        const person = personFromSeed(seed);
        if (!person.companyDomain) {
          const resolved = await resolveWebsiteMemo(seed.company, seed.location ?? "");
          if (resolved) {
            person.companyDomain = resolved.domain;
            person.collection.push({ source: "search", status: "ok", proxy: null, ms: 0, fieldsFound: 1, detail: `website resolved: ${resolved.domain}`, provider: resolved.provider });
          }
        }
        store.applySeedPeople(id, index, [person]);
        blocked.delete(index);
      } else if (isPerson) {
        // Enrich mode: a known person → find that one profile.
        const { person, matched, blocked: wasBlocked } = await resolvePersonViaCrawler({
          companyId: seed.companyId ?? null,
          company: seed.company,
          firstName: seed.firstName,
          lastName: seed.lastName,
          location: seed.location,
          domain: seed.domain ?? null,
          website: seed.website ?? null,
          linkedin: seed.linkedin ?? null,
        });
        // Keep the row even when no LinkedIn matched — the person is known and
        // still carries a guessed, verifiable email.
        store.applySeedPeople(id, index, [person]);
        if (wasBlocked && !matched) blocked.add(index);
        else blocked.delete(index);
      } else {
        // Discover mode: a company → all its founders/C-level.
        const { people, blocked: wasBlocked } = await resolvePeopleViaCrawler({
          companyId: seed.companyId ?? null,
          company: seed.company,
          location: seed.location,
          domain: seed.domain ?? null,
          website: seed.website ?? null,
          linkedin: seed.linkedin ?? null,
        });
        store.applySeedPeople(id, index, people);
        if (wasBlocked && people.length === 0) blocked.add(index);
        else blocked.delete(index);
      }
    } catch {
      store.failSeed(id, index);
    }
  }

  const runPass = async (idxs: number[], concurrency: number) => {
    let cursor = 0;
    const worker = async () => {
      while (cursor < idxs.length) await processIndex(idxs[cursor++]);
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, idxs.length || 1)) }, () => worker()));
  };

  // Main pass — full concurrency.
  await runPass(indexes, CONCURRENCY);

  // Retry passes — only blocked seeds, at low concurrency after a growing backoff
  // so the shared proxy pool cools down and we ride past the rate-limit.
  //
  // These retries ONLY help when a proxy rotation exists: a fresh IP is what lets
  // a rate-limited query succeed on the next pass. With no proxy every retry hits
  // the same server IP and returns `blocked` identically — so the passes are pure
  // waste, and (because each flips its seeds back to "collecting") they leave the
  // progress bar stuck just under 100% for many minutes. Skip them entirely when
  // the crawler reports no proxy, and hard-cap the phase wall-clock either way.
  const proxyAvailable = blocked.size ? await crawlerProxyAvailable() : true;
  const retryDeadline = Date.now() + RETRY_PHASE_BUDGET_MS;
  if (proxyAvailable) {
    for (let pass = 0; pass < RETRY_PASSES; pass++) {
      const idxs = [...blocked];
      if (!idxs.length) break; // no blocked seeds left → done
      if (Date.now() >= retryDeadline) break; // phase budget spent → stop the tail
      await sleep(Math.min(RETRY_BACKOFF_MS * (pass + 1), Math.max(0, retryDeadline - Date.now())));
      if (Date.now() >= retryDeadline) break;
      await runPass(idxs, RETRY_CONCURRENCY);
    }
  }

  store.finalizePeopleJob(id);
}

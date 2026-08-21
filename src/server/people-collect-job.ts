/**
 * Background runner for people collection ("Find people"). Delegates the REAL
 * work to the standalone crawler-service (X-ray on linkedin.com/in → parse →
 * classify → company-match → rank). Each seed company yields its decision-makers.
 * No mock data. Email verification is NOT automatic — opt-in via "Verify emails".
 */
import "server-only";
import { resolvePeopleViaCrawler, resolvePersonViaCrawler } from "./crawler-client";
import * as store from "./people-collect-store";

const CONCURRENCY = Math.max(1, Math.min(Number(process.env.CRAWLER_PEOPLE_CONCURRENCY ?? process.env.CRAWLER_CONCURRENCY ?? 3), 12));
const running = new Set<string>();

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
  let cursor = 0;

  async function worker() {
    while (cursor < indexes.length) {
      const index = indexes[cursor++];
      const seed = seeds[index];
      store.setSeedCollecting(id, index);
      try {
        const isPerson = !!(seed.firstName || seed.lastName);
        if (isPerson) {
          // Enrich mode: a known person → find that one profile.
          const { person, matched } = await resolvePersonViaCrawler({
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
          void matched;
          store.applySeedPeople(id, index, [person]);
        } else {
          // Discover mode: a company → all its founders/C-level.
          const { people } = await resolvePeopleViaCrawler({
            companyId: seed.companyId ?? null,
            company: seed.company,
            location: seed.location,
            domain: seed.domain ?? null,
            website: seed.website ?? null,
            linkedin: seed.linkedin ?? null,
          });
          store.applySeedPeople(id, index, people);
        }
      } catch {
        store.failSeed(id, index);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, indexes.length || 1) }, () => worker()));
  store.finalizePeopleJob(id);
}

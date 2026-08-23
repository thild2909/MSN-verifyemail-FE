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
// Block-retry: seeds that came back rate-limited (blocked, nothing found) are
// recoverable — re-run them after a backoff at low concurrency so a transient
// Brave rate-limit doesn't leave a person without their LinkedIn/title.
const RETRY_PASSES = Math.max(0, Number(process.env.CRAWLER_PEOPLE_RETRY_PASSES ?? 4));
const RETRY_BACKOFF_MS = Math.max(2000, Number(process.env.CRAWLER_PEOPLE_RETRY_BACKOFF_MS ?? 15_000));
const RETRY_CONCURRENCY = Math.max(1, Number(process.env.CRAWLER_PEOPLE_RETRY_CONCURRENCY ?? 2));
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
      if (isPerson) {
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
  for (let pass = 0; pass < RETRY_PASSES; pass++) {
    const idxs = [...blocked];
    if (!idxs.length) break; // no blocked seeds left → done
    await sleep(RETRY_BACKOFF_MS * (pass + 1));
    await runPass(idxs, RETRY_CONCURRENCY);
  }

  store.finalizePeopleJob(id);
}

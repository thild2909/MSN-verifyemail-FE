import { NextResponse } from "next/server";
import { z } from "zod";
import { cleanDomain } from "@/lib/finder/patterns";
import { resolvePeopleViaCrawler } from "@/server/crawler-client";
import { findManyEmailsLayered } from "@/server/people-verify";
import type { FinderResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Max discovered people resolved per domain search (each costs verifier calls). */
const MAX_PEOPLE = Number(process.env.FINDER_DOMAIN_MAX ?? 15);

const schema = z.object({ domain: z.string().trim().min(3).max(255) });

/**
 * Domain search: discover REAL people at the company (crawler-service /people —
 * founders / C-level from the company site, LinkedIn SERP, directories), then
 * resolve each through the same layered finder as single/bulk. Nothing is
 * invented: if no people are discovered, the result is empty.
 */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "A valid `domain` is required." } }, { status: 400 });
  }
  const domain = cleanDomain(parsed.data.domain);
  if (!domain || !domain.includes(".")) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "A valid `domain` is required." } }, { status: 400 });
  }

  let people;
  try {
    ({ people } = await resolvePeopleViaCrawler({ company: domain.split(".")[0], domain, website: `https://${domain}` }));
  } catch {
    return NextResponse.json({ success: false, error: { code: "CRAWLER_UNAVAILABLE", message: "People discovery is unavailable right now." } }, { status: 502 });
  }

  const named = people
    .filter((p) => p.firstName?.trim() && p.lastName?.trim())
    .slice(0, MAX_PEOPLE);
  if (named.length === 0) return NextResponse.json({ success: true, data: [] as FinderResult[] });

  const { results } = await findManyEmailsLayered(
    named.map((p) => ({
      firstName: p.firstName!.trim(),
      lastName: p.lastName!.trim(),
      name: p.name ?? undefined,
      domain,
      company: p.company ?? null,
      title: p.title?.value ?? null,
      linkedin: p.linkedin?.value ?? null,
    })),
  );

  const data: FinderResult[] = results.map((r, i) => ({
    ...r.outcome.result,
    id: `df_${i}`,
    name: named[i].name || `${named[i].firstName} ${named[i].lastName}`,
    jobTitle: named[i].title?.value ?? undefined,
    state: r.outcome.state,
  }));
  return NextResponse.json({ success: true, data });
}

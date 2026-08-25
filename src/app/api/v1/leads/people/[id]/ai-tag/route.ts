import { NextResponse } from "next/server";
import { z } from "zod";
import * as store from "@/server/people-collect-store";
import { tagPeopleViaCrawler, type TagPersonRecord } from "@/server/crawler-client";
import type { CollectedPerson } from "@/lib/leads/people-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bound how many rows one AI action scans so a huge job can't blow up latency /
// token cost. Rows beyond this are simply not considered (reported via `scanned`).
const SCAN_CAP = 800;

const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(500),
  search: z.string().nullish(),
});

function locationOf(p: CollectedPerson): string | null {
  if (p.location) return p.location;
  const parts = [p.city, p.state, p.country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/**
 * "AI Support" on the People tab: run a natural-language instruction (e.g.
 * "Highlight Indian names") over the job's people and return which rows to tag
 * plus a label/colour. The tag is applied client-side as an ephemeral highlight;
 * nothing is persisted. Honours the table's current search so the action targets
 * what the user is looking at.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getPeopleJob(id)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "People job not found." } }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "A `prompt` is required." } }, { status: 400 });
  }

  const { people, total } = store.getPeople(id, { search: parsed.data.search ?? "", page: 1, pageSize: SCAN_CAP });
  const records: TagPersonRecord[] = people.map((p) => ({
    id: p.id,
    name: p.name,
    title: p.title?.value ? String(p.title.value) : null,
    company: p.company || null,
    location: locationOf(p),
    email: p.email?.value ? String(p.email.value) : p.emailVerification?.email ?? null,
  }));

  if (records.length === 0) {
    return NextResponse.json({ success: true, data: { configured: true, tag: null, matchedIds: [], scanned: 0, total, tokens: 0 } });
  }

  try {
    const r = await tagPeopleViaCrawler(parsed.data.prompt, records);
    if (!r.configured) {
      return NextResponse.json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "Set DEEPSEEK_API_KEY to enable AI Support." } }, { status: 400 });
    }
    return NextResponse.json({
      success: true,
      data: { configured: true, tag: r.tag, matchedIds: r.matchedIds, scanned: r.scanned, total, tokens: r.tokens },
    });
  } catch {
    return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "AI Support failed. Try again." } }, { status: 502 });
  }
}

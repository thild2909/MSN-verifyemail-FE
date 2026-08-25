import { NextResponse } from "next/server";
import { z } from "zod";
import * as store from "@/server/people-collect-store";
import { be } from "@/server/verify-client";
import { personToLeadItem } from "@/lib/leads/lead-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resolve the whole selection from the store (the table caps at far fewer rows).
const RESOLVE_CAP = 200000;
// Forward to the leads backend in chunks: server↔server (no public proxy in
// between), sized so a 50k selection is ~100 round-trips, not thousands, while each
// body stays well under the BE bodyLimit. (BE add is O(batch), not O(list).)
const FORWARD_CHUNK = 500;

const querySchema = z
  .object({
    search: z.string().nullish(),
    ids: z.array(z.string()).nullish(),
    email: z.array(z.string()).nullish(),
    titles: z.array(z.string()).nullish(),
    seniority: z.array(z.string()).nullish(),
    linkedin: z.boolean().nullish(),
    funded: z.boolean().nullish(),
    companies: z.array(z.string()).nullish(),
    locations: z.array(z.string()).nullish(),
    employees: z.array(z.string()).nullish(),
    industries: z.array(z.string()).nullish(),
    minScore: z.number().nullish(),
    sort: z.string().nullish(),
  })
  .partial();

const bodySchema = z.object({
  listId: z.string().trim().min(1),
  all: z.boolean().default(false),
  personIds: z.array(z.string()).max(200000).optional(),
  query: querySchema.optional(),
});

// Drop null/undefined so the (nullable) parsed query conforms to the store's
// PeopleQuery, whose optional fields are `T | undefined` (no null).
function cleanQuery(o: Record<string, unknown> | undefined): store.PeopleQuery {
  return Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v != null)) as store.PeopleQuery;
}

/**
 * Add selected people to a list BY REFERENCE — the definitive fix for
 * "Could not add to list" on a large Select-all. The browser posts only the
 * selection (ids, or "all" + the filter context), never the row snapshots, so the
 * request stays a few KB and can't hit a proxy body limit. The server resolves the
 * rows from its own people store, builds the lead-item snapshots, and forwards them
 * to the leads backend in small chunks (each < 1 MB).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getPeopleJob(id)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "People job not found." } }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "A `listId` and selection are required." } }, { status: 400 });
  }
  const { listId, all, personIds, query } = parsed.data;

  // Resolve the target rows server-side (never trust the client for the snapshots).
  const people = all
    ? store.getPeople(id, { ...cleanQuery(query), page: 1, pageSize: RESOLVE_CAP }).people
    : (personIds && personIds.length
        ? store.getPeople(id, { ids: personIds, page: 1, pageSize: RESOLVE_CAP }).people
        : []);

  if (people.length === 0) {
    return NextResponse.json({ success: true, data: { added: 0, skipped: 0, count: 0 } });
  }

  const items = people.map((p) => personToLeadItem(p, id));
  let added = 0;
  let skipped = 0;
  for (let i = 0; i < items.length; i += FORWARD_CHUNK) {
    const chunk = items.slice(i, i + FORWARD_CHUNK);
    const res = await be<{ data: { added: number; skipped: number } }>(`/leads/lists/${encodeURIComponent(listId)}/items`, {
      method: "POST",
      body: JSON.stringify({ items: chunk }),
    });
    if (res.status === 404) {
      return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "List not found." } }, { status: 404 });
    }
    if (!res.ok) {
      return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not add items." } }, { status: 502 });
    }
    added += res.json.data.added;
    skipped += res.json.data.skipped ?? chunk.length - res.json.data.added;
  }

  return NextResponse.json({ success: true, data: { added, skipped, count: items.length } });
}

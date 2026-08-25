import { NextResponse } from "next/server";
import { z } from "zod";
import { be } from "@/server/verify-client";
import type { LeadItemsPage } from "@/lib/api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound() {
  return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "List not found." } }, { status: 404 });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const qs = new URL(req.url).searchParams.toString();
  const res = await be<{ data: LeadItemsPage }>(`/leads/lists/${encodeURIComponent(id)}/items${qs ? `?${qs}` : ""}`);
  if (res.status === 404) return notFound();
  if (!res.ok) return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not load items." } }, { status: 502 });
  return NextResponse.json({ success: true, data: res.json.data });
}

const leadItemSchema = z.object({
  kind: z.enum(["person", "company"]),
  refId: z.string().trim().min(1),
  jobId: z.string().nullish(),
  name: z.string().nullish(),
  company: z.string().nullish(),
  title: z.string().nullish(),
  email: z.string().nullish(),
  data: z.record(z.unknown()).default({}),
});
const addSchema = z.object({ items: z.array(leadItemSchema).min(1).max(1000) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "An `items` array is required." } }, { status: 400 });
  }
  const res = await be<{ data: { added: number } }>(`/leads/lists/${encodeURIComponent(id)}/items`, {
    method: "POST",
    body: JSON.stringify({ items: parsed.data.items }),
  });
  if (res.status === 404) return notFound();
  if (!res.ok) return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not add items." } }, { status: 502 });
  return NextResponse.json({ success: true, data: res.json.data });
}

const removeSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(5000) });

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = removeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "An `ids` array is required." } }, { status: 400 });
  }
  const res = await be<{ data: { removed: number } }>(`/leads/lists/${encodeURIComponent(id)}/items`, {
    method: "DELETE",
    body: JSON.stringify({ ids: parsed.data.ids }),
  });
  if (res.status === 404) return notFound();
  if (!res.ok) return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not remove items." } }, { status: 502 });
  return NextResponse.json({ success: true, data: res.json.data });
}

import { NextResponse } from "next/server";
import * as enrichStore from "@/server/enrich-store";
import * as store from "@/server/store";
import { startJob } from "@/server/verification-job";
import type { NewContact } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Loop-closer: turn a table's discovered emails into a Verification List and
 * kick off the existing verification pipeline.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const table = enrichStore.getEnrichTable(id);
  if (!table) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Enrichment table not found." } }, { status: 404 });

  const contacts: NewContact[] = enrichStore.collectEmails(id).map(({ email, fields }) => ({
    email,
    firstName: fields.first_name,
    lastName: fields.last_name,
    company: fields.company,
  }));

  if (contacts.length === 0) {
    return NextResponse.json({ success: false, error: { code: "NO_EMAILS", message: "No discovered emails to verify yet." } }, { status: 400 });
  }

  try {
    const { list } = store.createList({
      name: `${table.name} — enriched`,
      fileName: `${table.name}-enriched.csv`,
      columns: ["email", "first_name", "last_name", "company"],
      emailColumn: "email",
      contacts,
    });
    startJob(list.id);
    return NextResponse.json({ success: true, data: { listId: list.id, count: list.uniqueEmails } }, { status: 201 });
  } catch (err) {
    if (err instanceof store.CreditsError) {
      return NextResponse.json({ success: false, error: { code: err.code, message: err.message, required: err.required, available: err.available } }, { status: 402 });
    }
    return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not create verification list." } }, { status: 500 });
  }
}

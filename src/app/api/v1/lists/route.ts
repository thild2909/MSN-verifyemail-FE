import { NextResponse } from "next/server";
import { z } from "zod";
import * as store from "@/server/store";
import { startJob } from "@/server/verification-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contactSchema = z.object({
  email: z.string().trim().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  jobTitle: z.string().optional(),
  custom: z.record(z.string()).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  fileName: z.string().trim().min(1),
  columns: z.array(z.string()).default([]),
  emailColumn: z.string().default("email"),
  contacts: z.array(contactSchema).min(1).max(50_000),
});

export async function GET() {
  return NextResponse.json({ success: true, data: store.listAll() });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "Malformed JSON." } }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid body." } },
      { status: 400 },
    );
  }

  try {
    const { list, truncated } = store.createList(parsed.data);
    startJob(list.id); // fire-and-forget; verifies via the Rust engine
    return NextResponse.json({ success: true, data: list, truncated }, { status: 201 });
  } catch (err) {
    if (err instanceof store.CreditsError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message, required: err.required, available: err.available } },
        { status: 402 },
      );
    }
    return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not create list." } }, { status: 500 });
  }
}

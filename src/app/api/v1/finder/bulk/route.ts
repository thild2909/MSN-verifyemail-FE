import { NextResponse } from "next/server";
import { z } from "zod";
import { findManyEmails } from "@/server/finder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cap per request so a huge upload can't hammer the backend in one shot. */
const MAX_PEOPLE = Number(process.env.FINDER_BULK_MAX ?? 100);

const personSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  domain: z.string().trim().min(1).max(255),
});

const schema = z.object({
  people: z.array(personSchema).min(1).max(MAX_PEOPLE),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "Malformed JSON body.", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("INVALID_REQUEST", `A \`people\` array (1–${MAX_PEOPLE}) of {firstName, lastName, domain} is required.`, 400);
  }

  const response = await findManyEmails(parsed.data.people);
  return NextResponse.json({ success: true, data: response });
}

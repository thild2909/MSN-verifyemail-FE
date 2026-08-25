import { NextResponse } from "next/server";
import { be } from "@/server/verify-client";
import type { EmailList } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const res = await be<{ data: EmailList[] }>("/lists");
  if (!res.ok) return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not load lists." } }, { status: 502 });
  return NextResponse.json({ success: true, data: res.json.data });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "Malformed JSON." } }, { status: 400 });
  }

  const res = await be<{ data: EmailList; truncated: number; error?: { code: string; message: string; required?: number; available?: number } }>(
    "/lists",
    { method: "POST", body: JSON.stringify(body) },
  );

  if (res.status === 201) {
    return NextResponse.json({ success: true, data: res.json.data, truncated: res.json.truncated }, { status: 201 });
  }
  if (res.status === 402 && res.json.error) {
    const e = res.json.error;
    return NextResponse.json(
      { success: false, error: { code: e.code, message: e.message, required: e.required, available: e.available } },
      { status: 402 },
    );
  }
  if (res.status === 400) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "Invalid body." } }, { status: 400 });
  }
  return NextResponse.json({ success: false, error: { code: "INTERNAL", message: "Could not create list." } }, { status: 500 });
}

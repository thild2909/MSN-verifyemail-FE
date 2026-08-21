import { NextResponse } from "next/server";
import * as store from "@/server/people-collect-store";
import { llmVerifyPeople } from "@/server/people-llm-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** LLM (DeepSeek) founder↔company cross-check. `all=1` re-checks every person. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getPeopleJob(id)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "People job not found." } }, { status: 404 });
  }
  const all = new URL(req.url).searchParams.get("all") === "1";
  const result = await llmVerifyPeople(id, !all);
  if (!result.configured) {
    return NextResponse.json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "Set DEEPSEEK_API_KEY to enable AI verification." } }, { status: 400 });
  }
  return NextResponse.json({ success: true, data: result });
}

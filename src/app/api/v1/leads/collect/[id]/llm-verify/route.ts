import { NextResponse } from "next/server";
import * as store from "@/server/company-collect-store";
import { llmVerifyCompanies } from "@/server/company-llm-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** LLM (DeepSeek) cross-check of the collected companies. `all=1` re-checks every row. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getCollectJob(id)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Collection job not found." } }, { status: 404 });
  }
  const all = new URL(req.url).searchParams.get("all") === "1";
  const result = await llmVerifyCompanies(id, !all);
  if (!result.configured) {
    return NextResponse.json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "Set DEEPSEEK_API_KEY to enable AI verification." } }, { status: 400 });
  }
  return NextResponse.json({ success: true, data: result });
}

import { NextResponse } from "next/server";
import * as store from "@/server/people-collect-store";
import { llmVerifyPeople, llmEnrichPeople } from "@/server/people-llm-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "AI verify" (DeepSeek) on people, one click, two passes:
 *  1. FILL coverage-gap companies (0 found) — DeepSeek proposes founders/execs
 *     from knowledge; live crawl enriches LinkedIn when it can; remaining
 *     high-confidence proposals are still inserted as AI-sourced rows.
 *  2. AUDIT weak-signal people — founder↔company cross-check.
 * Fill runs first so freshly-added people can also be audited in the same click.
 * `all=1` re-runs every row / re-fills every gap company.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getPeopleJob(id)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "People job not found." } }, { status: 404 });
  }
  const all = new URL(req.url).searchParams.get("all") === "1";

  const fill = await llmEnrichPeople(id, !all);
  const audit = await llmVerifyPeople(id, !all);

  if (!audit.configured && !fill.configured) {
    return NextResponse.json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "Set DEEPSEEK_API_KEY to enable AI verification." } }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    data: {
      configured: true,
      // audit pass
      checked: audit.checked,
      skipped: audit.skipped,
      verified: audit.verified,
      mismatch: audit.mismatch,
      uncertain: audit.uncertain,
      corrected: audit.corrected,
      cleared: audit.cleared,
      // exec-fill pass
      gapCompanies: fill.companies,
      proposed: fill.proposed,
      filled: fill.verified,
      dropped: fill.dropped,
      tokens: audit.tokens + fill.tokens,
    },
  });
}

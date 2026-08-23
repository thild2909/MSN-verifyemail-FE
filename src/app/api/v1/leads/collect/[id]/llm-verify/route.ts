import { NextResponse } from "next/server";
import * as store from "@/server/company-collect-store";
import { llmVerifyCompanies, llmEnrichCompanies } from "@/server/company-llm-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "AI verify" (DeepSeek), one click, two passes:
 *  1. AUDIT enriched-but-uncertain rows (verified / mismatch / uncertain).
 *  2. FILL failed / not-found rows from the model's own knowledge.
 * Both are batched (merged prompts) to save tokens. `all=1` re-runs every row.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!store.getCollectJob(id)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Collection job not found." } }, { status: 404 });
  }
  const all = new URL(req.url).searchParams.get("all") === "1";

  // Fill first so freshly-filled rows can also be audited in the same click.
  const enrich = await llmEnrichCompanies(id, !all);
  const audit = await llmVerifyCompanies(id, !all);

  if (!audit.configured && !enrich.configured) {
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
      // enrichment pass
      targeted: enrich.targeted,
      filled: enrich.filled,
      notFound: enrich.notFound,
      tokens: audit.tokens + enrich.tokens,
    },
  });
}

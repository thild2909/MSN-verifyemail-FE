import { NextResponse } from "next/server";
import { z } from "zod";
import { aiReportViaCrawler } from "@/server/crawler-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  instructions: z.string().max(60_000).nullish(),
  limit: z.number().int().min(1).max(40).nullish(),
  provider: z.enum(["deepseek", "openai"]).default("deepseek"),
  model: z.string().trim().max(80).nullish(),
  smartSearch: z.boolean().nullish(),
  reasoningEffort: z.enum(["low", "medium", "high"]).nullish(),
});

/**
 * "Find with AI" on the Find Leads tab. Proxies a natural-language request (plus
 * an optional uploaded agent brief) to the crawler-service, which grounds it
 * with real web search and returns a ranked company report. No persistence.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_REQUEST", message: "A `prompt` is required." } },
      { status: 400 },
    );
  }

  try {
    const r = await aiReportViaCrawler(parsed.data.prompt, parsed.data.instructions ?? null, parsed.data.limit ?? 20, {
      provider: parsed.data.provider,
      model: parsed.data.model ?? undefined,
      smartSearch: parsed.data.smartSearch ?? undefined,
      reasoningEffort: parsed.data.reasoningEffort ?? undefined,
    });
    if (!r.configured) {
      const envVar = parsed.data.provider === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY";
      return NextResponse.json(
        { success: false, error: { code: "LLM_NOT_CONFIGURED", message: `Set ${envVar} in Settings → Config to use this model.` } },
        { status: 400 },
      );
    }
    return NextResponse.json({
      success: true,
      data: {
        provider: r.provider ?? parsed.data.provider,
        mode: r.mode ?? "knowledge",
        summary: r.summary ?? "",
        columns: r.columns ?? [],
        rows: r.rows ?? [],
        rejections: r.rejections ?? [],
        tokens: r.tokens ?? 0,
        model: r.model ?? "",
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL", message: "Report generation failed. Try again." } },
      { status: 502 },
    );
  }
}

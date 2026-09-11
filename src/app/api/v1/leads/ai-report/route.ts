import { NextResponse } from "next/server";
import { aiReportViaCrawler, type AiReportChatTurn } from "@/server/crawler-client";
import type { AiReportColumn } from "@/lib/leads/ai-report-columns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Generous ceiling: a long prompt is distilled server-side (meaning preserved), not
// blocked. Only content beyond this hard abuse ceiling is dropped.
const MAX_PROMPT = 60_000;
const MAX_BRIEF = 60_000;

/**
 * Sanitise input rather than rejecting it: clamp/trim/drop bad values so the user
 * is only ever blocked when there is genuinely nothing to act on (an empty prompt).
 */
function sanitizeHistory(v: unknown): AiReportChatTurn[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const turns = v
    .filter((t): t is { role: unknown; text: unknown } => !!t && typeof t === "object")
    .map((t) => ({ role: t.role === "assistant" ? "assistant" as const : "user" as const, text: typeof t.text === "string" ? t.text.slice(0, 20_000) : "" }))
    .filter((t) => t.text.trim())
    .slice(-24);
  return turns.length ? turns : undefined;
}

function sanitizeBase(v: unknown): { columns: AiReportColumn[]; rows: Record<string, string>[] } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as { columns?: unknown; rows?: unknown };
  const columns: AiReportColumn[] = Array.isArray(o.columns)
    ? o.columns
        .filter((c): c is { key?: unknown; label?: unknown } => !!c && typeof c === "object")
        .map((c) => ({ key: String(c.key ?? "").slice(0, 60), label: String(c.label ?? "").slice(0, 80) }))
        .filter((c) => c.key)
        .slice(0, 40)
    : [];
  const rows: Record<string, string>[] = Array.isArray(o.rows)
    ? o.rows
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        .slice(0, 40)
        .map((r) => {
          const out: Record<string, string> = {};
          for (const [k, val] of Object.entries(r)) out[String(k)] = val == null ? "" : String(val).slice(0, 4000);
          return out;
        })
    : [];
  return rows.length ? { columns, rows } : undefined;
}

/**
 * "Find with AI" on the Find Leads tab. Proxies a natural-language request (plus
 * an optional uploaded agent brief) to the crawler-service, which grounds it
 * with real web search and returns a ranked company report. No persistence.
 *
 * Input is sanitised, not gate-kept: an over-long prompt is trimmed (not
 * rejected), a bad `limit`/`provider`/optional field falls back to a default, and
 * malformed `history`/`base` are dropped. The only hard stop is an empty prompt.
 */
export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const b = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;

  const promptFull = typeof b.prompt === "string" ? b.prompt.trim() : "";
  const prompt = promptFull.slice(0, MAX_PROMPT);
  if (!prompt) {
    return NextResponse.json(
      { success: false, error: { code: "EMPTY_PROMPT", message: "Please describe the companies and roles you want to find." } },
      { status: 400 },
    );
  }
  const trimmedNote = promptFull.length > MAX_PROMPT
    ? `Your prompt was very long — only the first ${MAX_PROMPT.toLocaleString()} characters were used. For long briefs, use the Brief button instead.`
    : undefined;

  const instructions = typeof b.instructions === "string" && b.instructions.trim() ? b.instructions.slice(0, MAX_BRIEF) : null;
  const limitNum = Math.floor(Number(b.limit));
  const limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.min(40, limitNum) : 20;
  const provider = b.provider === "openai" ? "openai" : "deepseek";
  const model = typeof b.model === "string" && b.model.trim() ? b.model.trim().slice(0, 80) : undefined;
  const smartSearch = b.smartSearch === true ? true : undefined;
  const reasoningEffort = b.reasoningEffort === "low" || b.reasoningEffort === "medium" || b.reasoningEffort === "high" ? b.reasoningEffort : undefined;
  const history = sanitizeHistory(b.history);
  const base = sanitizeBase(b.base);

  try {
    const r = await aiReportViaCrawler(prompt, instructions, limit, { provider, model, smartSearch, reasoningEffort, history, base });
    if (!r.configured) {
      const envVar = provider === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY";
      return NextResponse.json(
        { success: false, error: { code: "LLM_NOT_CONFIGURED", message: `Set ${envVar} in Settings → Config to use this model.` } },
        { status: 400 },
      );
    }
    return NextResponse.json({
      success: true,
      data: {
        provider: r.provider ?? provider,
        mode: r.mode ?? "knowledge",
        summary: r.summary ?? "",
        columns: r.columns ?? [],
        rows: r.rows ?? [],
        rejections: r.rejections ?? [],
        tokens: r.tokens ?? 0,
        model: r.model ?? "",
        ...(trimmedNote ? { notice: trimmedNote } : {}),
      },
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      {
        success: false,
        error: {
          code: aborted ? "TIMEOUT" : "INTERNAL",
          message: aborted
            ? "The report took too long to generate. Try a smaller row count or a simpler prompt."
            : "Couldn't generate the report right now. Please try again.",
        },
      },
      { status: aborted ? 504 : 502 },
    );
  }
}

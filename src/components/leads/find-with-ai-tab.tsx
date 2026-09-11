"use client";
import * as React from "react";
import Papa from "papaparse";
import {
  Sparkles, Paperclip, ArrowUp, Loader2, X, Download, FileText, AlertTriangle, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { columnWidth, type AiReportColumn } from "@/lib/leads/ai-report-columns";

type Row = Record<string, string>;
interface Rejection { company: string; reason: string }
interface ReportPayload {
  provider?: string;
  mode?: "knowledge" | "research";
  summary: string;
  columns: AiReportColumn[];
  rows: Row[];
  rejections?: Rejection[];
  tokens: number;
  model: string;
}
interface AttachedFile { fileName: string; chars: number; text: string }
type Message =
  | { id: string; role: "user"; text: string; fileName?: string }
  | { id: string; role: "assistant"; report: ReportPayload }
  | { id: string; role: "error"; text: string };

const uid = () => Math.random().toString(36).slice(2);
const MAX_PROMPT_CHARS = 60_000;

// Compact a previous report into the minimum the model needs to refine it:
// just the identifying + filterable fields, capped to a sensible number of rows.
// Summary / notes / website are dropped — they cost tokens and dilute accuracy.
const HISTORY_ROW_CAP = 30;
function reportToText(r: ReportPayload): string {
  const rows = r.rows ?? [];
  const lines = rows.slice(0, HISTORY_ROW_CAP).map((row, i) => {
    const parts = [row.company, row.country, row.employees, row.role].map((s) => (s || "").trim()).filter(Boolean);
    return `${i + 1}. ${parts.join(" | ")}`;
  });
  const more = rows.length > HISTORY_ROW_CAP ? `\n…(+${rows.length - HISTORY_ROW_CAP} more)` : "";
  return `Current list (${rows.length} companies):\n${lines.join("\n")}${more}`;
}

// Build the conversation context to send with a follow-up prompt, Claude-style:
// keep the accumulated user criteria (short, essential) plus ONLY the most recent
// report (the list being refined). Older reports are superseded → dropped.
function buildHistory(msgs: Message[]): { role: "user" | "assistant"; text: string }[] {
  const userTurns: { role: "user" | "assistant"; text: string }[] = [];
  let lastReport: ReportPayload | null = null;
  for (const m of msgs) {
    if (m.role === "user") userTurns.push({ role: "user", text: m.text.slice(0, 700) });
    else if (m.role === "assistant") lastReport = m.report; // keep only the latest
    // error bubbles are skipped
  }
  const turns = userTurns.slice(-6); // recent criteria only
  if (lastReport) turns.push({ role: "assistant", text: reportToText(lastReport) });
  return turns;
}

type ProviderId = "deepseek" | "openai";
type Effort = "low" | "medium" | "high";
interface ProviderOptions { smartSearch?: boolean; reasoningEffort?: boolean }
interface ProviderInfo { id: ProviderId; label: string; configured: boolean; model: string; models?: string[]; options?: ProviderOptions }
const PROVIDER_FALLBACK: ProviderInfo[] = [
  { id: "deepseek", label: "DeepSeek", configured: true, model: "deepseek-chat", models: ["deepseek-chat", "deepseek-reasoner"], options: { smartSearch: true } },
  { id: "openai", label: "ChatGPT (OpenAI)", configured: false, model: "gpt-4o-mini", models: ["gpt-4o", "gpt-4o-mini", "o3-mini", "o4-mini"], options: { reasoningEffort: true } },
];
const PROVIDER_STORE_KEY = "msn_ai_provider";
const MODELS_STORE_KEY = "msn_ai_models";
const SMART_STORE_KEY = "msn_ai_smartsearch";
const EFFORT_STORE_KEY = "msn_ai_effort";

const PROMPT_IDEAS = [
  "20 APAC startups hiring AI/ML engineers in the last 2 weeks, 5 each from SG, HK, AU, MY",
  "Series A–B fintechs in Southeast Asia with open backend roles and a founder/CTO recipient",
  "Companies posting senior DevOps/SRE roles in Australia this month that lack an India delivery team",
];

export function FindWithAiTab() {
  const { toast } = useToast();
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState("");
  const [file, setFile] = React.useState<AttachedFile | null>(null);
  const [limit, setLimit] = React.useState(20);
  const [loading, setLoading] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [provider, setProvider] = React.useState<ProviderId>("deepseek");
  const [providers, setProviders] = React.useState<ProviderInfo[]>(PROVIDER_FALLBACK);
  const [modelByProvider, setModelByProvider] = React.useState<Record<string, string>>({});
  const [smartSearch, setSmartSearch] = React.useState(false);
  const [effort, setEffort] = React.useState<Effort>("medium");

  // Load which providers are configured, and restore saved model/option choices.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      let list: ProviderInfo[] = PROVIDER_FALLBACK;
      try {
        const res = await fetch("/api/v1/leads/ai-report/providers");
        const json = await res.json();
        if (json?.data?.providers?.length) list = json.data.providers;
      } catch { /* keep fallback */ }
      if (cancelled) return;
      setProviders(list);

      const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
      const configured = list.filter((p) => p.configured).map((p) => p.id);
      const savedProvider = read(PROVIDER_STORE_KEY);
      setProvider((savedProvider && configured.includes(savedProvider as ProviderId) ? savedProvider : configured[0] ?? "deepseek") as ProviderId);

      const savedModels = (() => { try { return JSON.parse(read(MODELS_STORE_KEY) || "{}"); } catch { return {}; } })();
      const defaults: Record<string, string> = {};
      for (const p of list) defaults[p.id] = savedModels[p.id] || p.model || p.models?.[0] || "";
      setModelByProvider(defaults);

      setSmartSearch(read(SMART_STORE_KEY) === "1");
      const e = read(EFFORT_STORE_KEY);
      if (e === "low" || e === "medium" || e === "high") setEffort(e);
    })();
    return () => { cancelled = true; };
  }, []);

  const current = providers.find((p) => p.id === provider);
  const currentModels = current?.models ?? [];
  const currentModel = modelByProvider[provider] || current?.model || currentModels[0] || "";
  const showSmart = !!current?.options?.smartSearch;
  const showEffort = !!current?.options?.reasoningEffort;

  function onProviderChange(id: ProviderId) {
    setProvider(id);
    try { localStorage.setItem(PROVIDER_STORE_KEY, id); } catch { /* ignore */ }
  }
  function onModelChange(id: string) {
    setModelByProvider((prev) => {
      const next = { ...prev, [provider]: id };
      try { localStorage.setItem(MODELS_STORE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  function onSmartChange(v: boolean) {
    setSmartSearch(v);
    try { localStorage.setItem(SMART_STORE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
  }
  function onEffortChange(v: Effort) {
    setEffort(v);
    try { localStorage.setItem(EFFORT_STORE_KEY, v); } catch { /* ignore */ }
  }

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Keep the latest message in view as the thread grows / loading toggles.
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // Auto-grow the composer textarea up to a cap.
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(72, Math.min(el.scrollHeight, 240))}px`;
  }, [input]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/v1/leads/ai-report/parse-file", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json?.error?.message || "Could not read the file.");
      setFile({ fileName: json.data.fileName, chars: json.data.chars, text: json.data.text });
      toast({ variant: "success", title: "Brief attached", description: `${json.data.fileName} · ${json.data.chars.toLocaleString()} chars` });
    } catch (err) {
      toast({ variant: "error", title: "Upload failed", description: (err as Error).message });
    } finally {
      setUploading(false);
    }
  }

  async function send() {
    const rawPrompt = input.trim();
    if (!rawPrompt || loading) return;
    // Clamp very long input rather than letting the request fail; tell the user.
    const prompt = rawPrompt.slice(0, MAX_PROMPT_CHARS);
    if (rawPrompt.length > MAX_PROMPT_CHARS) {
      toast({ variant: "warning", title: "Prompt shortened", description: `Only the first ${MAX_PROMPT_CHARS.toLocaleString()} characters were used. For long briefs, use the Brief button.` });
    }
    const history = buildHistory(messages); // prior turns (before this new one)
    // The latest report becomes the base table the follow-up patches (server keeps
    // unchanged rows + quota; the model only returns the change set).
    const lastReport = [...messages].reverse().find((m) => m.role === "assistant") as Extract<Message, { role: "assistant" }> | undefined;
    const base = lastReport?.report
      ? { columns: lastReport.report.columns ?? [], rows: (lastReport.report.rows ?? []).slice(0, 40) }
      : undefined;
    const userMsg: Message = { id: uid(), role: "user", text: prompt, fileName: file?.fileName };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/v1/leads/ai-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          instructions: file?.text ?? null,
          limit,
          provider,
          model: currentModel || undefined,
          smartSearch: showSmart ? smartSearch : undefined,
          reasoningEffort: showEffort ? effort : undefined,
          history: history.length ? history : undefined,
          base,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json?.error?.message || "Report generation failed.");
      if (json.data?.notice) toast({ variant: "warning", title: "Heads up", description: String(json.data.notice) });
      setMessages((m) => [...m, { id: uid(), role: "assistant", report: json.data as ReportPayload }]);
    } catch (err) {
      setMessages((m) => [...m, { id: uid(), role: "error", text: (err as Error).message }]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Thread */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {empty ? (
          <EmptyState onPick={(s) => setInput(s)} />
        ) : (
          <div className="mx-auto flex max-w-5xl flex-col gap-5">
            {messages.map((m) =>
              m.role === "user" ? (
                <UserBubble key={m.id} text={m.text} fileName={m.fileName} />
              ) : m.role === "error" ? (
                <ErrorBubble key={m.id} text={m.text} />
              ) : (
                <AssistantReport key={m.id} report={m.report} />
              ),
            )}
            {loading && <ThinkingBubble />}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t bg-background px-4 py-3 sm:px-5">
        <div className="mx-auto max-w-5xl">
          {file && (
            <div className="mb-2 inline-flex items-center gap-2 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-xs">
              <FileText className="size-3.5 text-muted-foreground" />
              <span className="max-w-[220px] truncate font-medium">{file.fileName}</span>
              <span className="text-muted-foreground">{file.chars.toLocaleString()} chars</span>
              <button onClick={() => setFile(null)} className="rounded p-0.5 hover:bg-muted" aria-label="Remove brief">
                <X className="size-3.5" />
              </button>
            </div>
          )}
          <div className="flex flex-col gap-2 rounded-2xl border bg-card p-2.5 shadow-sm transition-shadow focus-within:border-ring/50 focus-within:shadow-md">
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.txt,.md,.markdown"
              className="hidden"
              onChange={onPickFile}
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder="Describe the companies and roles you want to find…"
              className="max-h-[240px] min-h-[72px] w-full resize-none bg-transparent px-1.5 py-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
            />
            {/* Toolbar */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                title="Attach an agent brief (.docx / .txt / .md)"
              >
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
                <span className="hidden sm:inline">Brief</span>
              </Button>

              {/* Provider selector */}
              <div className="relative shrink-0">
                <select
                  value={provider}
                  onChange={(e) => onProviderChange(e.target.value as ProviderId)}
                  title="AI provider"
                  className="h-8 cursor-pointer appearance-none rounded-lg border bg-background pl-2.5 pr-7 text-xs font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.configured}>
                      {p.label}{p.configured ? "" : " — not configured"}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>

              {/* Model selector (per provider) */}
              {currentModels.length > 0 && (
                <div className="relative shrink-0">
                  <select
                    value={currentModel}
                    onChange={(e) => onModelChange(e.target.value)}
                    title="Model"
                    className="h-8 cursor-pointer appearance-none rounded-lg border bg-background pl-2.5 pr-7 text-xs font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {currentModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                </div>
              )}

              {/* DeepSeek: smart-search toggle */}
              {showSmart && (
                <button
                  type="button"
                  onClick={() => onSmartChange(!smartSearch)}
                  title="Smart search — brainstorm a wider candidate pool before ranking (slower, better coverage)"
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
                    smartSearch ? "border-primary/40 bg-primary/10 text-primary" : "bg-background text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Sparkles className="size-3.5" />
                  <span className="hidden sm:inline">Smart search</span>
                </button>
              )}

              {/* ChatGPT: thinking effort */}
              {showEffort && (
                <div className="relative shrink-0" title="Thinking effort (reasoning models)">
                  <select
                    value={effort}
                    onChange={(e) => onEffortChange(e.target.value as Effort)}
                    className="h-8 cursor-pointer appearance-none rounded-lg border bg-background pl-2.5 pr-7 text-xs font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="low">Effort: low</option>
                    <option value="medium">Effort: medium</option>
                    <option value="high">Effort: high</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                </div>
              )}

              {/* Rows stepper */}
              <label
                className="hidden h-8 shrink-0 items-center gap-1.5 rounded-lg border bg-background pl-2.5 pr-1.5 text-xs text-muted-foreground transition-colors focus-within:ring-1 focus-within:ring-ring hover:bg-muted sm:flex"
                title="Number of companies to return"
              >
                Rows
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={limit}
                  onChange={(e) => setLimit(Math.max(1, Math.min(40, Number(e.target.value) || 20)))}
                  className="w-8 bg-transparent text-center font-medium text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </label>

              <Button
                type="button"
                size="icon"
                className="ml-auto size-9 shrink-0 rounded-full"
                disabled={!input.trim() || loading}
                onClick={() => void send()}
                title="Generate report"
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              </Button>
            </div>
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
            {showSmart && smartSearch
              ? "Smart search ON — crawls live job boards for real dated postings + URLs, then verifies each against your brief (slower)."
              : "Generates the list from the model's knowledge (fast). Turn on Smart search to verify against live job postings."}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ sub-views -------------------------------- */

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center pt-10 text-center sm:pt-16">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Sparkles className="size-7" />
      </div>
      <h2 className="text-lg font-bold tracking-tight">Find leads with AI</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Attach an agent brief (optional) and describe your ideal targets. AI searches live job boards and company
        sources, then returns a ranked company report you can export.
      </p>
      <div className="mt-6 grid w-full gap-2">
        {PROMPT_IDEAS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-xl border bg-card px-4 py-3 text-left text-sm transition-colors hover:bg-muted"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserBubble({ text, fileName }: { text: string; fileName?: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
        {fileName && (
          <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-md bg-primary-foreground/15 px-2 py-0.5 text-xs">
            <FileText className="size-3" /> {fileName}
          </div>
        )}
        <p className="whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  );
}

function ErrorBubble({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      <span>Planning queries, searching the web, and composing the report…</span>
    </div>
  );
}

function AssistantReport({ report }: { report: ReportPayload }) {
  const { rows, summary } = report;
  const columns = report.columns?.length ? report.columns : [];

  function exportCsv() {
    const header = columns.map((c) => c.label);
    const data = rows.map((r) => columns.map((c) => r[c.key] ?? ""));
    const csv = Papa.unparse({ fields: header, data });
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `company-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          {summary && <p className="whitespace-pre-wrap text-sm leading-relaxed">{summary}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Sparkles className="size-3" /> AI-generated{report.model ? ` · ${report.model}` : ""}
            </span>
            <span>{rows.length} companies</span>
          </div>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="rounded-xl border">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company report</span>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={exportCsv}>
              <Download className="size-3.5" /> Export CSV
            </Button>
          </div>
          <div className="max-w-full overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  {columns.map((c) => (
                    <th key={c.key} className={cn("whitespace-nowrap px-2.5 py-2 font-semibold", columnWidth(c.key))}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b align-top last:border-0 hover:bg-muted/30">
                    {columns.map((c) => (
                      <td key={c.key} className={cn("px-2.5 py-2", columnWidth(c.key))}>
                        <Cell value={r[c.key]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No companies matched. Try refining your request.</p>
      )}

      {report.rejections && report.rejections.length > 0 && (
        <details className="rounded-xl border bg-muted/20 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-semibold text-muted-foreground">
            Rejection list ({report.rejections.length}) — strong candidates that failed a rule
          </summary>
          <ul className="mt-2 space-y-1.5">
            {report.rejections.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-medium">{r.company}</span>
                <span className="text-muted-foreground">— {r.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// Domain like "grab.com" or "tngdigital.com.my" (no scheme, no path).
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

function OneLink({ token }: { token: string }) {
  const t = token.trim();
  const isUrl = /^https?:\/\//i.test(t);
  const isDomain = !isUrl && DOMAIN_RE.test(t);
  if (!t) return null;
  if (isUrl || isDomain) {
    const href = isUrl ? t : `https://${t}`;
    let label = t.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    if (label.length > 48) label = label.slice(0, 45) + "…"; // keep the cell compact
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline" title={t}>
        {label}
      </a>
    );
  }
  return <span className="whitespace-pre-wrap break-words">{t}</span>;
}

/**
 * Render a cell value. "Direct job source" (and any multi-link field) may carry
 * several newline-separated URLs — each becomes its own clickable link. A single
 * URL/bare-domain is linked; everything else is plain wrapped text.
 */
function Cell({ value }: { value: string }) {
  const v = (value || "").trim();
  if (!v || v === "—") return <span>—</span>;
  const tokens = v.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const hasLink = tokens.some((t) => /^https?:\/\//i.test(t) || DOMAIN_RE.test(t));
  if (hasLink) {
    return (
      <div className="flex flex-col gap-0.5">
        {tokens.map((t, i) => <OneLink key={i} token={t} />)}
      </div>
    );
  }
  return <span className="whitespace-pre-wrap break-words">{v}</span>;
}


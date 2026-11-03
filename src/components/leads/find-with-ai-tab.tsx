"use client";
import { ColHead } from "@/components/common/col-head";
import * as React from "react";
import Papa from "papaparse";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles, Paperclip, ArrowUp, Loader2, X, Download, FileText, AlertTriangle, ChevronDown, ListPlus, Plus,
  Radar, Info, Lightbulb, ArrowUpRight, Building2, SearchX, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/common/empty-state";
import { IconTile, Pill } from "@/components/common/kit";
import { cn, formatNumber } from "@/lib/utils";
import { getLeadLists, createLeadList, addLeadItems } from "@/lib/api/client";
import { aiReportToCompanyLeadItems, addToListToast } from "@/lib/leads/lead-snapshot";
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
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Thread */}
      <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {empty ? (
          <AiWelcome onPick={(s) => setInput(s)} />
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
      <div className="border-t border-border bg-card/60 px-4 py-3 backdrop-blur sm:px-6 sm:py-4">
        <div className="mx-auto max-w-5xl">
          {file && (
            <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-card py-1 pl-1 pr-1.5 text-xs shadow-xs">
              <IconTile icon={FileText} tone="brand" size="sm" />
              <span className="min-w-0 max-w-[220px] truncate font-medium">{file.fileName}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{file.chars.toLocaleString()} chars</span>
              <button
                onClick={() => setFile(null)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                aria-label="Remove brief"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card transition-[border-color,box-shadow] focus-within:border-brand/50 focus-within:ring-[3px] focus-within:ring-brand/15">
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.txt,.md,.markdown"
              className="hidden"
              onChange={onPickFile}
            />
            <div className="flex items-start gap-3 px-3 pt-3 sm:px-4">
              <IconTile icon={Sparkles} tone="violet" size="sm" className="mt-0.5 hidden sm:flex" />
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={2}
                placeholder="Describe the companies and roles you want to find…"
                /* text-base (16px) on mobile stops iOS Safari auto-zooming on focus; back to text-sm from sm+. */
                className="max-h-[240px] min-h-[72px] w-full resize-none bg-transparent py-1 text-base leading-relaxed outline-none placeholder:text-muted-foreground sm:text-sm"
              />
            </div>
            {/* Toolbar */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border bg-surface/50 px-2 py-2 sm:px-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                title="Attach an agent brief (.docx / .txt / .md)"
              >
                {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
                <span className="hidden sm:inline">Brief</span>
              </Button>

              <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" aria-hidden />

              {/* Provider selector */}
              <div className="relative shrink-0">
                <select
                  value={provider}
                  onChange={(e) => onProviderChange(e.target.value as ProviderId)}
                  title="AI provider"
                  className={SELECT_CLASS}
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
                    className={cn(SELECT_CLASS, "font-mono text-[11px]")}
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
                  aria-pressed={smartSearch}
                  title="Smart search — brainstorm a wider candidate pool before ranking (slower, better coverage)"
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium shadow-xs transition-colors",
                    smartSearch
                      ? "border-brand/40 bg-brand/10 text-brand"
                      : "border-border bg-card text-muted-foreground hover:bg-surface hover:text-foreground",
                  )}
                >
                  {smartSearch ? <span className="size-1.5 rounded-full bg-brand animate-pulse" aria-hidden /> : <Sparkles className="size-3.5" strokeWidth={1.75} />}
                  <span className="hidden sm:inline">Smart search</span>
                </button>
              )}

              {/* ChatGPT: thinking effort */}
              {showEffort && (
                <div className="inline-flex shrink-0 items-center rounded-lg border border-border bg-surface p-0.5" title="Thinking effort (reasoning models)" role="radiogroup" aria-label="Thinking effort">
                  <span className="hidden px-1.5 text-[11px] font-medium text-muted-foreground sm:inline">Effort</span>
                  {(["low", "medium", "high"] as const).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      role="radio"
                      aria-checked={effort === lvl}
                      onClick={() => onEffortChange(lvl)}
                      className={cn(
                        "rounded-md px-2 py-0.5 text-xs font-medium capitalize transition-colors",
                        effort === lvl ? "bg-card text-brand shadow-xs" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              )}

              {/* Rows stepper */}
              <label
                className="hidden h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card pl-2.5 pr-1.5 text-xs text-muted-foreground shadow-xs transition-colors focus-within:border-brand/50 focus-within:ring-[3px] focus-within:ring-brand/15 hover:bg-surface sm:flex"
                title="Number of companies to return"
              >
                Rows
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={limit}
                  onChange={(e) => setLimit(Math.max(1, Math.min(40, Number(e.target.value) || 20)))}
                  className="w-8 rounded bg-surface py-0.5 text-center font-semibold tabular-nums text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </label>

              <Button
                type="button"
                className="ml-auto h-8 shrink-0 gap-1.5 px-3"
                disabled={!input.trim() || loading}
                onClick={() => void send()}
                title="Generate report"
                aria-label="Generate report"
              >
                {loading ? <Loader2 className="animate-spin" /> : <ArrowUp />}
                <span className="hidden sm:inline">Generate</span>
              </Button>
            </div>
          </div>
          <p className="mt-2 flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-muted-foreground">
            {showSmart && smartSearch ? (
              <Radar className="mt-px size-3 shrink-0 text-brand" strokeWidth={1.75} />
            ) : (
              <Info className="mt-px size-3 shrink-0" strokeWidth={1.75} />
            )}
            <span>
              {showSmart && smartSearch
                ? "Smart search ON — crawls live job boards for real dated postings + URLs, then verifies each against your brief (slower)."
                : "Generates the list from the model's knowledge (fast). Turn on Smart search to verify against live job postings."}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

const SELECT_CLASS =
  "h-8 max-w-[180px] cursor-pointer appearance-none truncate rounded-md border border-border bg-card pl-2.5 pr-7 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-surface focus:border-brand/50 focus:outline-none focus:ring-[3px] focus:ring-brand/15";

/* ------------------------------ sub-views -------------------------------- */

function AiWelcome({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center pt-6 text-center sm:pt-14">
      <div className="relative mb-5">
        <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-brand/10 blur-2xl" aria-hidden />
        <IconTile icon={Sparkles} tone="violet" className="size-14 rounded-2xl [&>svg]:size-6" />
      </div>
      <Pill tone="violet" className="mb-2 normal-case">AI research</Pill>
      <h2 className="text-xl font-semibold tracking-tight">Find leads with AI</h2>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
        Attach an agent brief (optional) and describe your ideal targets. AI searches live job boards and company
        sources, then returns a ranked company report you can export.
      </p>
      <div className="mt-8 w-full text-left">
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Try a prompt</p>
        <div className="grid w-full gap-2 sm:grid-cols-3">
          {PROMPT_IDEAS.map((s) => (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="group flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5 text-left text-[13px] leading-relaxed shadow-xs transition-[border-color,box-shadow] hover:border-brand/40 hover:shadow-card"
            >
              <span className="flex items-center justify-between">
                <IconTile icon={Lightbulb} tone="brand" size="sm" />
                <ArrowUpRight className="size-4 text-muted-foreground transition-colors group-hover:text-brand" strokeWidth={1.75} />
              </span>
              <span className="text-foreground/90">{s}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function UserBubble({ text, fileName }: { text: string; fileName?: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-xs">
        {fileName && (
          <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-md bg-primary-foreground/15 px-2 py-0.5 text-xs font-medium">
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
    <div className="flex items-start gap-3 rounded-xl border border-[hsl(var(--invalid)/0.3)] bg-[hsl(var(--invalid)/0.06)] p-3 text-sm">
      <IconTile icon={AlertTriangle} tone="invalid" size="sm" />
      <div className="min-w-0 pt-0.5">
        <p className="text-[13px] font-semibold text-[hsl(var(--invalid))]">Report failed</p>
        <p className="mt-0.5 break-words text-[13px] text-foreground/80">{text}</p>
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand/10">
          <Loader2 className="size-3.5 animate-spin text-brand" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">Generating report</p>
          <p className="truncate text-xs text-muted-foreground">Planning queries, searching the web, and composing the report…</p>
        </div>
      </div>
      <div className="space-y-2 p-4" aria-hidden>
        {[92, 78, 85, 64].map((w, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-3 w-24 animate-pulse rounded bg-surface" />
            <div className="h-3 animate-pulse rounded bg-surface" style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function AssistantReport({ report }: { report: ReportPayload }) {
  const { rows, summary } = report;
  const columns = report.columns?.length ? report.columns : [];

  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: lists = [] } = useQuery({ queryKey: ["lead-lists"], queryFn: getLeadLists });
  const [busy, setBusy] = React.useState(false);
  const [newListOpen, setNewListOpen] = React.useState(false);
  const [newListName, setNewListName] = React.useState("");

  /**
   * Turn the AI report rows into deduped company lead items. The known columns
   * feed the company snapshot; every other dynamic column (type, role, job
   * location, posting date, source, signal, MSN fit, notes…) is captured in the
   * structured `aiReport` field, persisted server-side in its own queryable
   * `ai_report` column and shown in the saved company's detail.
   */
  const companyItems = () =>
    aiReportToCompanyLeadItems(columns, rows, { model: report.model });

  const addToList = async (listId: string, listName: string) => {
    setBusy(true);
    try {
      const items = companyItems();
      if (items.length === 0) { toast({ variant: "info", title: "No companies to add" }); return; }
      const { added, skipped } = await addLeadItems(listId, items);
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
      toast(addToListToast(added, skipped, listName));
    } catch { toast({ variant: "error", title: "Could not add to list" }); }
    finally { setBusy(false); }
  };

  const createAndAdd = async () => {
    const name = newListName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const items = companyItems();
      if (items.length === 0) { toast({ variant: "info", title: "No companies to add" }); setNewListOpen(false); return; }
      const list = await createLeadList(name);
      const { added, skipped } = await addLeadItems(list.id, items);
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
      setNewListOpen(false); setNewListName("");
      toast(addToListToast(added, skipped, list.name));
    } catch { toast({ variant: "error", title: "Could not create list" }); }
    finally { setBusy(false); }
  };

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
      <div className="flex items-start gap-3">
        <IconTile icon={Sparkles} tone="violet" size="sm" className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1.5">
          {summary && <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{summary}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone="violet" className="normal-case">
              <Sparkles className="size-3" /> AI-generated
            </Pill>
            {report.model && <Pill tone="muted" className="font-mono normal-case">{report.model}</Pill>}
            <Pill tone="brand" className="normal-case tabular-nums">{rows.length} companies</Pill>
          </div>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <Building2 className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <span className="text-[13px] font-semibold">Company report</span>
              <span className="rounded-md bg-surface px-1.5 py-px text-[11px] font-semibold tabular-nums text-muted-foreground">{formatNumber(rows.length)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <DropdownMenu align="end" trigger={
                <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs" disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <ListPlus />} Add to list <ChevronDown className="opacity-60" />
                </Button>
              }>
                {lists.map((l) => (
                  <DropdownItem key={l.id} onClick={() => addToList(l.id, l.name)}><ListPlus /> {l.name} <span className="ml-auto text-xs tabular-nums text-muted-foreground">{l.summary.total}</span></DropdownItem>
                ))}
                {lists.length > 0 && <DropdownSeparator />}
                <DropdownItem onClick={() => { setNewListName(""); setNewListOpen(true); }}><Plus /> New list</DropdownItem>
              </DropdownMenu>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs" onClick={exportCsv}>
                <Download /> Export CSV
              </Button>
            </div>
          </div>
          <div className="scrollbar-thin max-w-full overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-surface/95 text-left text-[13px] font-normal text-muted-foreground">
                  {columns.map((c) => (
                    <th key={c.key} className={cn("whitespace-nowrap px-3 py-2.5 font-normal first:pl-4 last:pr-4", columnWidth(c.key))}>
                      <ColHead label={c.label} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border align-top transition-colors last:border-0 hover:bg-surface/60">
                    {columns.map((c, ci) => (
                      <td key={c.key} className={cn("px-3 py-2.5 leading-relaxed first:pl-4 last:pr-4", ci === 0 && "font-medium text-foreground", columnWidth(c.key))}>
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
        <EmptyState
          icon={SearchX}
          title="No companies matched"
          description="Try refining your request."
          className="py-10"
        />
      )}

      {report.rejections && report.rejections.length > 0 && (
        <details className="group overflow-hidden rounded-xl border border-border bg-card text-xs shadow-xs">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 transition-colors hover:bg-surface/60 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
            <span className="font-semibold text-foreground">Rejection list</span>
            <Pill tone="risky" className="tabular-nums">{report.rejections.length}</Pill>
            <span className="hidden truncate text-muted-foreground sm:inline">— strong candidates that failed a rule</span>
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {report.rejections.map((r, i) => (
              <li key={i} className="flex flex-col gap-0.5 px-4 py-2 sm:flex-row sm:gap-3">
                <span className="shrink-0 font-medium text-foreground sm:w-48 sm:truncate">{r.company}</span>
                <span className="text-muted-foreground">{r.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* New list dialog — name it, then add the report's companies. */}
      <Dialog open={newListOpen} onOpenChange={(o) => { if (!o) { setNewListOpen(false); setNewListName(""); } }}>
        <DialogHeader>
          <IconTile icon={ListPlus} tone="brand" className="mb-3" />
          <DialogTitle>New list</DialogTitle>
          <DialogDescription>Name the list, then add the {formatNumber(rows.length)} {rows.length === 1 ? "company" : "companies"} from this report.</DialogDescription>
        </DialogHeader>
        <Input autoFocus value={newListName} onChange={(e) => setNewListName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newListName.trim()) createAndAdd(); }} placeholder="List name" />
        <DialogFooter>
          <Button variant="outline" onClick={() => setNewListOpen(false)}>Cancel</Button>
          <Button disabled={!newListName.trim() || busy} onClick={createAndAdd}>{busy ? <Loader2 className="animate-spin" /> : null} Create &amp; add</Button>
        </DialogFooter>
      </Dialog>
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
      <a href={href} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-brand hover:underline" title={t}>
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
  if (!v || v === "—") return <span className="text-muted-foreground">—</span>;
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


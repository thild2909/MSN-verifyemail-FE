"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Bot, Search, KeyRound, Info, Shuffle, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsCard, Pill, IconTile, type Tone } from "@/components/settings/settings-ui";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { getAppConfig, setAppConfig, type AppConfig, type AppConfigField, type AppConfigKey } from "@/lib/api/client";

interface FieldDef {
  key: AppConfigKey;
  label: string;
  placeholder: string;
  help?: string;
  mono?: boolean;
  /** When present, render a dropdown of these choices instead of a text input. */
  options?: { value: string; label: string }[];
}
interface GroupDef {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  fields: FieldDef[];
}

const GROUPS: GroupDef[] = [
  {
    title: "AI models",
    description: "LLM for cross-check and Find with AI. DeepSeek is the default; add an OpenAI key to use ChatGPT.",
    icon: Bot,
    fields: [
      { key: "DEEPSEEK_API_KEY", label: "DeepSeek API key", placeholder: "sk-…", help: "platform.deepseek.com key.", mono: true },
      { key: "DEEPSEEK_MODEL", label: "DeepSeek model", placeholder: "deepseek-chat", mono: true },
      { key: "OPENAI_API_KEY", label: "OpenAI API key", placeholder: "sk-…", help: "platform.openai.com key — enables the ChatGPT option in Find with AI.", mono: true },
      { key: "OPENAI_MODEL", label: "OpenAI model", placeholder: "gpt-4o", help: "Model for “Find with AI” reports.", mono: true },
      { key: "LLM_NAME_STRUCTURE_MODEL", label: "Email name-analysis model (Layer 5)", placeholder: "gpt-4o-mini", help: "Model for the email finder’s Layer-5 name-ethnicity / email-structure step. Cheap tier is enough — the address is SMTP-verified anyway. Default gpt-4o-mini.", mono: true },
    ],
  },
  {
    title: "Search & crawl",
    description: "Decodo is the crawl backend (real-Google SERP + residential web scraper). Google API is an optional higher-accuracy alternative.",
    icon: Search,
    fields: [
      { key: "DECODO_AUTH", label: "Decodo auth", placeholder: "base64(user:pass)", help: "Decodo SERP + Web Scraping API Basic-auth token. Powers all crawling.", mono: true },
      { key: "GOOGLE_API_KEY", label: "Google API key", placeholder: "AIza…", mono: true },
      { key: "GOOGLE_CX", label: "Google CX", placeholder: "Programmable Search engine ID", mono: true },
    ],
  },
  {
    title: "Proxy rotation (Layer 1)",
    description: "System-wide rotating proxy pool for crawling. When set, all crawlers try a rotating proxy IP first (Layer 1) to avoid IP blocks; the residential scraper (Decodo) is the Layer 2 fallback only when a proxy is blocked. Leave blank to crawl direct.",
    icon: Shuffle,
    fields: [
      {
        key: "WEBSHARE_PROXY_LIST_URL",
        label: "Proxy-list URL (Webshare)",
        placeholder: "https://proxy.webshare.io/api/v2/proxy/list/download/…",
        help: "Webshare “Download proxy list” URL (ip:port:user:pass lines). The crawler fetches this list and rotates through the IPs.",
        mono: true,
      },
    ],
  },
  {
    title: "Email verification fallback",
    description:
      "When a mailbox provider (e.g. Proofpoint) blocks SMTP verification from our servers, the engine can only return “unknown”. Route just those blocked checks to a third-party verifier that has clean IP pools. Leave the provider Off to disable — blocked checks then stay “unknown”.",
    icon: MailCheck,
    fields: [
      {
        key: "TP_VERIFIER_PROVIDER",
        label: "Fallback provider",
        placeholder: "Off",
        help: "Which external verifier to call for gateway-blocked addresses. Off = no fallback.",
        options: [
          { value: "", label: "Off (no fallback)" },
          { value: "emaillistverify", label: "EmailListVerify" },
          { value: "millionverifier", label: "MillionVerifier" },
          { value: "zerobounce", label: "ZeroBounce" },
          { value: "neverbounce", label: "NeverBounce" },
          { value: "reacher", label: "Reacher (SaaS)" },
        ],
      },
      {
        key: "TP_VERIFIER_API_KEY",
        label: "Provider API key",
        placeholder: "provider secret / API key",
        help: "API key/secret for the selected provider. Each fallback lookup spends one provider credit; only gateway-blocked “unknown” checks trigger it.",
        mono: true,
      },
    ],
  },
];

const GROUP_TONE: Record<string, Tone> = {
  "AI models": "violet",
  "Search & crawl": "sky",
  "Proxy rotation (Layer 1)": "risky",
  "Email verification fallback": "valid",
};

export default function ConfigSettingsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["app-config"], queryFn: getAppConfig });

  // Draft edits keyed by setting key. A key present with "" and marked cleared
  // sends an explicit clear; absent = leave untouched.
  const [draft, setDraft] = React.useState<Partial<Record<AppConfigKey, string>>>({});
  const [cleared, setCleared] = React.useState<Set<AppConfigKey>>(new Set());

  const byKey = React.useMemo(() => {
    const m = new Map<AppConfigKey, AppConfigField>();
    for (const f of data?.fields ?? []) m.set(f.key, f);
    return m;
  }, [data]);

  const reset = React.useCallback(() => { setDraft({}); setCleared(new Set()); }, []);

  const save = useMutation({
    mutationFn: () => {
      const patch: Partial<Record<AppConfigKey, string>> = {};
      for (const g of GROUPS) {
        for (const f of g.fields) {
          const meta = byKey.get(f.key);
          const secret = meta?.secret ?? true;
          if (cleared.has(f.key)) { patch[f.key] = ""; continue; }
          const v = draft[f.key];
          if (v === undefined) continue;
          if (secret) {
            if (v.trim() !== "") patch[f.key] = v.trim();
          } else if (v !== (meta?.value ?? "")) {
            patch[f.key] = v;
          }
        }
      }
      return setAppConfig(patch);
    },
    onSuccess: (cfg: AppConfig) => {
      qc.setQueryData(["app-config"], cfg);
      reset();
      toast({ variant: "success", title: "Configuration saved", description: "Applied to the crawler service — no restart needed." });
    },
    onError: (e) => toast({ variant: "error", title: "Could not save", description: e instanceof Error ? e.message : undefined }),
  });

  // Dirty when something was cleared, or a draft differs from the saved value.
  // Non-secret fields (incl. the provider select) count "" as a real change so
  // choosing "Off" enables Save; secrets only count a non-blank draft.
  const dirty =
    cleared.size > 0 ||
    GROUPS.some((g) =>
      g.fields.some((f) => {
        const d = draft[f.key];
        if (d === undefined) return false;
        const meta = byKey.get(f.key);
        const secret = meta?.secret ?? true;
        return secret ? d.trim() !== "" : d !== (meta?.value ?? "");
      }),
    );

  // Configured-count per group for the header pill and the overview.
  const configured = (g: GroupDef) => g.fields.filter((f) => byKey.get(f.key)?.hasValue && !cleared.has(f.key)).length;
  const totalFields = GROUPS.reduce((n, g) => n + g.fields.length, 0);
  const totalSet = GROUPS.reduce((n, g) => n + configured(g), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-brand/20 bg-brand/[0.04] p-4">
        <IconTile icon={Info} tone="brand" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">Live service configuration</p>
          <p className="mt-0.5 text-muted-foreground">
            These settings live on the crawler service and <strong className="text-foreground">override the <code className="rounded bg-surface px-1 text-xs">.env</code> file</strong>, so no redeploy is needed.
            Secrets are stored server-side and shown masked. Leave a secret blank to keep it, or use <em>Clear</em> to fall back to <code className="rounded bg-surface px-1 text-xs">.env</code>.
          </p>
        </div>
        {!isLoading && (
          <span className="hidden shrink-0 text-right sm:block">
            <span className="block text-lg font-semibold tabular-nums">{totalSet}/{totalFields}</span>
            <span className="block text-[11px] text-muted-foreground">configured</span>
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground"><Loader2 className="mx-auto size-5 animate-spin" /></div>
      ) : (
        <>
          {GROUPS.map((g) => {
            const n = configured(g);
            return (
              <SettingsCard
                key={g.title}
                icon={g.icon}
                tone={GROUP_TONE[g.title] ?? "brand"}
                title={g.title}
                description={g.description}
                aside={<Pill tone={n === g.fields.length ? "valid" : n > 0 ? "risky" : "muted"}>{n}/{g.fields.length} set</Pill>}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  {g.fields.map((f) => {
                    const meta = byKey.get(f.key);
                    const secret = meta?.secret ?? true;
                    const isCleared = cleared.has(f.key);
                    const value = isCleared ? "" : draft[f.key] ?? (secret ? "" : meta?.value ?? "");
                    const placeholder = secret && meta?.hasValue && !isCleared ? `${meta.value} — leave blank to keep` : f.placeholder;
                    const wide = g.fields.length === 1 || (f.help?.length ?? 0) > 90 || f.placeholder.length > 40;
                    return (
                      <div key={f.key} className={cn("space-y-1.5", wide && "sm:col-span-2")}>
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor={f.key} className="flex min-w-0 items-center gap-1.5 text-[13px]">
                            {secret && <KeyRound className="size-3 shrink-0 text-muted-foreground" />}
                            <span className="truncate">{f.label}</span>
                            {isCleared ? (
                              <Pill tone="invalid">Will clear</Pill>
                            ) : (
                              meta?.hasValue && <Pill tone={meta.overridden ? "valid" : "sky"}>{meta.overridden ? "Set" : "From .env"}</Pill>
                            )}
                          </Label>
                          {secret && meta?.hasValue && (
                            <button
                              type="button"
                              onClick={() => setCleared((s) => { const n = new Set(s); if (n.has(f.key)) n.delete(f.key); else n.add(f.key); return n; })}
                              className="shrink-0 text-xs font-medium text-muted-foreground hover:text-[hsl(var(--invalid))]"
                            >
                              {isCleared ? "Undo clear" : "Clear"}
                            </button>
                          )}
                        </div>
                        {f.options ? (
                          <Select
                            id={f.key}
                            value={value}
                            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                          >
                            {f.options.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </Select>
                        ) : secret ? (
                          <PasswordInput
                            id={f.key}
                            className={f.mono ? "font-mono text-xs" : undefined}
                            value={value}
                            disabled={isCleared}
                            placeholder={isCleared ? "Will fall back to .env on save" : placeholder}
                            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                          />
                        ) : (
                          <Input
                            id={f.key}
                            type="text"
                            className={f.mono ? "font-mono text-xs" : undefined}
                            value={value}
                            placeholder={placeholder}
                            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                          />
                        )}
                        {f.help && <p className="text-[11px] leading-relaxed text-muted-foreground">{f.help}</p>}
                      </div>
                    );
                  })}
                </div>
              </SettingsCard>
            );
          })}

          {/* Sticky save bar */}
          <div
            className={cn(
              "sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-pop backdrop-blur transition-colors lg:bottom-4",
              dirty ? "border-brand/40" : "border-border",
            )}
          >
            <p className="text-sm text-muted-foreground">
              {dirty ? (
                <span className="inline-flex items-center gap-2 font-medium text-foreground">
                  <span className="size-2 rounded-full bg-brand" /> Unsaved changes
                </span>
              ) : (
                "All changes saved"
              )}
            </p>
            <div className="flex gap-2">
              {dirty && <Button variant="ghost" onClick={reset} disabled={save.isPending}>Discard</Button>}
              <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" />} Save changes
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

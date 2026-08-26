"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Bot, Server, Search, KeyRound, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { getAppConfig, setAppConfig, type AppConfig, type AppConfigField, type AppConfigKey } from "@/lib/api/client";

interface FieldDef {
  key: AppConfigKey;
  label: string;
  placeholder: string;
  help?: string;
  mono?: boolean;
}
interface GroupDef {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  fields: FieldDef[];
}

const GROUPS: GroupDef[] = [
  {
    title: "AI verify (DeepSeek)",
    description: "LLM cross-check of crawled companies & founders.",
    icon: Bot,
    fields: [
      { key: "DEEPSEEK_API_KEY", label: "API key", placeholder: "sk-…", help: "platform.deepseek.com key.", mono: true },
      { key: "DEEPSEEK_MODEL", label: "Model", placeholder: "deepseek-chat", mono: true },
    ],
  },
  {
    title: "Proxy",
    description: "Route crawling through residential IPs to avoid rate limits.",
    icon: Server,
    fields: [
      { key: "CRAWLER_ROTATING_PROXY", label: "Rotating endpoint", placeholder: "http://user-rotate:pass@p.webshare.io:80", help: "Webshare backbone — a fresh IP per request.", mono: true },
      { key: "CRAWLER_PROXY_LIST_URL", label: "Proxy list download URL", placeholder: "https://proxy.webshare.io/api/v2/proxy/list/download/…", help: "A Webshare list-download link. When set, it takes precedence over the rotating endpoint.", mono: true },
    ],
  },
  {
    title: "Search",
    description: "Higher-accuracy search providers (optional — keyless Brave is the default).",
    icon: Search,
    fields: [
      { key: "DECODO_AUTH", label: "Decodo SERP auth", placeholder: "base64(user:pass)", help: "Decodo / Smartproxy SERP API Basic-auth token.", mono: true },
      { key: "GOOGLE_API_KEY", label: "Google API key", placeholder: "AIza…", mono: true },
      { key: "GOOGLE_CX", label: "Google CX", placeholder: "Programmable Search engine ID", mono: true },
    ],
  },
];

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

  const dirty = Object.keys(draft).some((k) => draft[k as AppConfigKey] !== undefined && (draft[k as AppConfigKey] ?? "") !== "") || cleared.size > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-muted-foreground">
          These settings live on the crawler service and <strong className="text-foreground">override the <code>.env</code> file</strong> — no redeploy.
          Secrets are stored server-side and shown masked. Leave a secret blank to keep the current value, or use <em>Clear</em> to remove your override and fall back to <code>.env</code>.
        </p>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground"><Loader2 className="mx-auto size-5 animate-spin" /></div>
      ) : (
        <>
          {GROUPS.map((g) => {
            const Icon = g.icon;
            return (
              <Card key={g.title}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><Icon className="size-4 text-primary" /> {g.title}</CardTitle>
                  <CardDescription>{g.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {g.fields.map((f) => {
                    const meta = byKey.get(f.key);
                    const secret = meta?.secret ?? true;
                    const isCleared = cleared.has(f.key);
                    const value = isCleared ? "" : draft[f.key] ?? (secret ? "" : meta?.value ?? "");
                    const placeholder = secret && meta?.hasValue && !isCleared ? `${meta.value} — leave blank to keep` : f.placeholder;
                    return (
                      <div key={f.key} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor={f.key} className="flex items-center gap-1.5">
                            {secret && <KeyRound className="size-3 text-muted-foreground" />}
                            {f.label}
                            {meta?.hasValue && !isCleared && (
                              <span className="rounded-full bg-[hsl(var(--valid))]/12 px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--valid))]">
                                {meta.overridden ? "Set" : "From .env"}
                              </span>
                            )}
                          </Label>
                          {secret && meta?.hasValue && (
                            <button
                              type="button"
                              onClick={() => setCleared((s) => { const n = new Set(s); if (n.has(f.key)) n.delete(f.key); else n.add(f.key); return n; })}
                              className="text-xs text-muted-foreground hover:text-[hsl(var(--invalid))]"
                            >
                              {isCleared ? "Undo clear" : "Clear"}
                            </button>
                          )}
                        </div>
                        {secret ? (
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
                        {f.help && <p className="text-[11px] text-muted-foreground">{f.help}</p>}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}

          <div className="flex justify-end gap-2">
            {dirty && <Button variant="ghost" onClick={reset} disabled={save.isPending}>Discard</Button>}
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              {save.isPending ? <Loader2 className="size-4 animate-spin" /> : "Save changes"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

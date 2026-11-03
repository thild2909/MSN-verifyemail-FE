"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Plus, Copy, Key, Webhook as WebhookIcon, Check, KeyRound, Activity, ShieldCheck, Globe, Send, CircleCheck,
  CircleAlert, Coins, ListChecks, History, MoreHorizontal, Ban, Info, TriangleAlert, Eye, EyeOff, Loader2, Zap,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown-menu";
import { IconTile, Pill, SectionCard, Field, type Tone } from "@/components/common/kit";
import { ColHead } from "@/components/common/col-head";
import { getApiKeys, getWebhooks, getWebhookDeliveries } from "@/lib/api/client";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/types";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn, formatNumber, formatDate, formatDateTime } from "@/lib/utils";

const EVENT_META: Record<WebhookEvent, { title: string; desc: string; icon: React.ElementType; tone: Tone }> = {
  "verification.completed": { title: "Verification completed", desc: "A single or bulk verification finished.", icon: CircleCheck, tone: "valid" },
  "verification.failed": { title: "Verification failed", desc: "A verification job errored or was aborted.", icon: CircleAlert, tone: "invalid" },
  "list.completed": { title: "List completed", desc: "Every record in an uploaded list was processed.", icon: ListChecks, tone: "violet" },
  "credits.low": { title: "Credits running low", desc: "Your balance dropped below the alert threshold.", icon: Coins, tone: "risky" },
};

const TH = "whitespace-nowrap px-4 py-3 text-left text-[13px] font-normal text-muted-foreground first:pl-5 last:pr-5";
const TD = "px-4 py-3 first:pl-5 last:pr-5";

export function ApiKeysManager() {
  const { data: keys = [] } = useQuery({ queryKey: ["apiKeys"], queryFn: getApiKeys });
  const { data: webhooks = [] } = useQuery({ queryKey: ["webhooks"], queryFn: getWebhooks });
  const { data: deliveries = [] } = useQuery({ queryKey: ["webhookDeliveries"], queryFn: getWebhookDeliveries });
  const { toast } = useToast();
  const confirm = useConfirm();

  const [createOpen, setCreateOpen] = React.useState(false);
  const [webhookUrl, setWebhookUrl] = React.useState(webhooks[0]?.url ?? "https://app.mindsupernova.com/webhooks/email-verification");
  const [events, setEvents] = React.useState<Record<string, boolean>>(
    Object.fromEntries(WEBHOOK_EVENTS.map((e) => [e, webhooks[0]?.events.includes(e) ?? false])),
  );

  const active = keys.filter((k) => k.status === "active");
  const totalRequests = keys.reduce((n, k) => n + k.requests, 0);
  const maxRequests = keys.reduce((m, k) => Math.max(m, k.requests), 0);
  const lastUsed = keys.map((k) => k.lastUsedAt).filter(Boolean).sort().at(-1);
  const enabledEvents = Object.values(events).filter(Boolean).length;
  const urlOk = /^https:\/\/[^\s/]+\.[^\s]+/.test(webhookUrl.trim());

  const revoke = async (name: string) => {
    if (await confirm({ title: "Revoke API key?", description: `“${name}” will stop working immediately. Any integration using it will fail. This can’t be undone.`, confirmText: "Revoke", destructive: true }))
      toast({ variant: "warning", title: "Key revoked", description: name });
  };

  return (
    <div className="space-y-6">
      {/* Backend status — keys/webhooks aren't persisted yet, so say so plainly. */}
      <div className="flex items-start gap-3 rounded-xl border border-[hsl(var(--risky)/0.3)] bg-[hsl(var(--risky)/0.06)] p-4">
        <IconTile icon={Info} tone="risky" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">API access isn&apos;t connected to a backend yet</p>
          <p className="mt-0.5 text-muted-foreground">
            Keys generated here are a preview only — they aren&apos;t stored and won&apos;t authenticate requests. Webhook settings aren&apos;t saved either.
          </p>
        </div>
      </div>

      {/* Summary */}
      <Card className="grid grid-cols-2 divide-border lg:grid-cols-4 lg:divide-x">
        {[
          { label: "Active keys", value: formatNumber(active.length), sub: `${formatNumber(keys.length)} total`, icon: KeyRound, tone: "brand" as Tone },
          { label: "Requests", value: formatNumber(totalRequests), sub: "All keys, all time", icon: Activity, tone: "sky" as Tone },
          { label: "Last used", value: lastUsed ? formatDate(lastUsed) : "Never", sub: lastUsed ? "Most recent request" : "No traffic yet", icon: History, tone: "risky" as Tone },
          { label: "Webhook events", value: `${enabledEvents}/${WEBHOOK_EVENTS.length}`, sub: urlOk ? "Endpoint set" : "No valid endpoint", icon: WebhookIcon, tone: "violet" as Tone },
        ].map((s) => (
          <div key={s.label} className="flex min-w-0 items-center gap-3 px-4 py-3.5 sm:px-5">
            <IconTile icon={s.icon} tone={s.tone} className="rounded-full" />
            <div className="min-w-0">
              <p className="truncate text-[13px] text-muted-foreground">{s.label}</p>
              <p className="truncate text-[15px] font-semibold tabular-nums">{s.value}</p>
              <p className="truncate text-[11px] text-muted-foreground">{s.sub}</p>
            </div>
          </div>
        ))}
      </Card>

      {/* Keys */}
      <SectionCard
        icon={Key}
        tone="brand"
        title="API keys"
        description="Scoped secrets for server-to-server verification. Never ship them in client-side code."
        aside={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus /> Create key</Button>}
        bodyClassName="p-0"
      >
        {keys.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl border border-border bg-card text-brand shadow-xs">
              <KeyRound className="size-5" strokeWidth={1.75} />
            </span>
            <p className="text-sm font-semibold">No API keys yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">Create a key to call <code className="rounded bg-surface px-1">/api/v1/verify</code> from your own servers.</p>
            <Button size="sm" variant="brand" className="mt-2" onClick={() => setCreateOpen(true)}><Plus /> Create your first key</Button>
          </div>
        ) : (
          <>
            {/* Mobile */}
            <ul className="divide-y divide-border md:hidden">
              {keys.map((k) => (
                <li key={k.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <IconTile icon={Key} tone={k.status === "active" ? "brand" : "muted"} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{k.name}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{k.maskedKey}</p>
                    </div>
                    <Pill tone={k.status === "active" ? "valid" : "muted"} dot>{k.status}</Pill>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-10 text-xs text-muted-foreground">
                    <span>Created {formatDate(k.createdAt)}</span>
                    <span>Last used {k.lastUsedAt ? formatDate(k.lastUsedAt) : "never"}</span>
                    <span className="tabular-nums">{formatNumber(k.requests)} req</span>
                  </div>
                  {k.status === "active" && (
                    <Button size="sm" variant="outline" className="ml-10 mt-2 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => revoke(k.name)}>
                      <Ban /> Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>

            {/* Desktop */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface">
                    <th className={TH}><ColHead label="Name" icon={Key} /></th>
                    <th className={TH}><ColHead label="Key" icon={KeyRound} /></th>
                    <th className={TH}><ColHead label="Created" /></th>
                    <th className={TH}><ColHead label="Last used" /></th>
                    <th className={TH}><ColHead label="Requests" /></th>
                    <th className={TH}><ColHead label="Status" /></th>
                    <th className={TH} />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface/60">
                      <td className={TD}>
                        <div className="flex items-center gap-2.5">
                          <IconTile icon={Key} tone={k.status === "active" ? "brand" : "muted"} size="sm" />
                          <span className="font-medium">{k.name}</span>
                        </div>
                      </td>
                      <td className={TD}><code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{k.maskedKey}</code></td>
                      <td className={cn(TD, "tabular-nums text-muted-foreground")}>{formatDate(k.createdAt)}</td>
                      <td className={cn(TD, "tabular-nums text-muted-foreground")}>{k.lastUsedAt ? formatDate(k.lastUsedAt) : "Never"}</td>
                      <td className={TD}>
                        <div className="flex items-center gap-2">
                          <span className="w-14 tabular-nums">{formatNumber(k.requests)}</span>
                          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-border">
                            <span className="block h-full rounded-full bg-brand" style={{ width: `${maxRequests ? (k.requests / maxRequests) * 100 : 0}%` }} />
                          </span>
                        </div>
                      </td>
                      <td className={TD}><Pill tone={k.status === "active" ? "valid" : "muted"} dot>{k.status}</Pill></td>
                      <td className={cn(TD, "text-right")}>
                        {k.status === "active" && (
                          <DropdownMenu trigger={<button className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground" aria-label={`Actions for ${k.name}`}><MoreHorizontal className="size-4" /></button>}>
                            <DropdownItem destructive onClick={() => revoke(k.name)}><Ban /> Revoke key</DropdownItem>
                          </DropdownMenu>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Webhook config */}
        <SectionCard
          className="lg:col-span-3"
          icon={WebhookIcon}
          tone="violet"
          title="Webhook"
          description="Choose an endpoint and the events you want to receive."
          aside={<Pill tone={urlOk && enabledEvents > 0 ? "valid" : "muted"} dot>{urlOk && enabledEvents > 0 ? "Ready" : "Not configured"}</Pill>}
          footer={
            <Button onClick={() => toast({ variant: "success", title: "Webhook saved" })} disabled={!urlOk}>
              <Check /> Save webhook
            </Button>
          }
        >
          <Field label="Endpoint URL" htmlFor="wh-url" error={webhookUrl && !urlOk ? "Use a public https:// URL." : undefined} hint="Must accept POST requests over HTTPS.">
            <div className="relative">
              <Globe className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="wh-url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} className="pl-9 font-mono text-[13px]" autoComplete="off" />
            </div>
          </Field>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-medium">Events</p>
              <span className="text-xs text-muted-foreground"><span className="font-semibold tabular-nums text-foreground">{enabledEvents}</span> of {WEBHOOK_EVENTS.length} selected</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {WEBHOOK_EVENTS.map((ev) => {
                const m = EVENT_META[ev];
                const on = !!events[ev];
                return (
                  <label
                    key={ev}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-all",
                      on ? "border-brand/50 bg-brand/[0.04]" : "border-border hover:border-brand/30",
                    )}
                  >
                    <IconTile icon={m.icon} tone={on ? m.tone : "muted"} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{m.title}</span>
                      <code className="block truncate font-mono text-[11px] text-muted-foreground">{ev}</code>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{m.desc}</span>
                    </span>
                    <Switch checked={on} onCheckedChange={(v) => setEvents((s) => ({ ...s, [ev]: v }))} />
                  </label>
                );
              })}
            </div>
          </div>
        </SectionCard>

        {/* Signing info */}
        <SectionCard className="lg:col-span-2" icon={ShieldCheck} tone="valid" title="How deliveries work" description="Signed events with automatic retries.">
          <ol className="space-y-3 text-sm">
            {[
              { icon: Send, text: "Each enabled event is POSTed to your endpoint as JSON." },
              { icon: KeyRound, text: "Deliveries are signed so you can confirm they came from us." },
              { icon: Zap, text: "Failed deliveries are retried automatically." },
            ].map((s, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <IconTile icon={s.icon} tone={(["sky", "brand", "risky"] as Tone[])[i]} size="sm" />
                <span className="pt-1 text-muted-foreground">{s.text}</span>
              </li>
            ))}
          </ol>
          <pre className="scrollbar-thin mt-4 overflow-x-auto rounded-lg border border-border bg-[hsl(229_22%_9%)] p-3 text-[11px] leading-relaxed text-[hsl(225_20%_88%)]">
            <code>{`{
  "event": "list.completed",
  "data": { "list_id": "lst_9f2a", "valid": 812 }
}`}</code>
          </pre>
        </SectionCard>
      </div>

      {/* Deliveries */}
      <SectionCard icon={History} tone="sky" title="Recent deliveries" description="The last attempts we made to your endpoint." bodyClassName="p-0">
        {deliveries.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">No deliveries yet. They&apos;ll appear here once an enabled event fires.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className={TH}><ColHead label="Event" /></th>
                  <th className={TH}><ColHead label="Response" /></th>
                  <th className={TH}><ColHead label="Status" /></th>
                  <th className={TH}><ColHead label="Time" /></th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-b border-border/60 last:border-0 hover:bg-surface/60">
                    <td className={TD}><code className="font-mono text-xs">{d.event}</code></td>
                    <td className={TD}>
                      <span className={cn("rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold", d.responseCode < 300 ? "bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]" : "bg-[hsl(var(--invalid)/0.1)] text-[hsl(var(--invalid))]")}>{d.responseCode}</span>
                    </td>
                    <td className={TD}><Pill tone={d.status === "success" ? "valid" : d.status === "retrying" ? "risky" : "invalid"} dot>{d.status}</Pill></td>
                    <td className={cn(TD, "tabular-nums text-muted-foreground")}>{formatDateTime(d.attemptedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

/* ----------------------------- create dialog ------------------------------ */

function CreateKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [generated, setGenerated] = React.useState<string | null>(null);
  const [show, setShow] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [working, setWorking] = React.useState(false);

  React.useEffect(() => {
    if (open) { setName(""); setGenerated(null); setShow(false); setCopied(false); }
  }, [open]);

  const createKey = () => {
    setWorking(true);
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    const secret = "sk_live_" + Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
    setTimeout(() => { setGenerated(secret); setWorking(false); }, 250);
  };

  const copy = async () => {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated);
      setCopied(true);
      toast({ variant: "success", title: "Copied to clipboard" });
    } catch {
      toast({ variant: "error", title: "Could not copy" });
    }
  };

  const masked = generated ? generated.slice(0, 12) + "•".repeat(20) + generated.slice(-4) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <div className="mb-3 flex items-center gap-3">
          <IconTile icon={generated ? Check : KeyRound} tone={generated ? "valid" : "brand"} />
          <div>
            <DialogTitle>{generated ? "Key created" : "Create API key"}</DialogTitle>
            <DialogDescription>{generated ? "Copy it now — for security it won't be shown again." : "Give your key a name you'll recognise later."}</DialogDescription>
          </div>
        </div>
        {/* Steps */}
        <div className="flex items-center gap-2 text-[11px] font-medium">
          {["Name", "Copy secret"].map((s, i) => {
            const done = i === 0 && !!generated;
            const cur = (i === 0 && !generated) || (i === 1 && !!generated);
            return (
              <React.Fragment key={s}>
                {i > 0 && <span className="h-px w-6 bg-border" />}
                <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5", cur ? "bg-brand/10 text-brand" : done ? "bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]" : "bg-surface text-muted-foreground")}>
                  {done ? <Check className="size-3" /> : <span className="tabular-nums">{i + 1}</span>} {s}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      </DialogHeader>

      {generated ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface/60 p-2 pl-3">
            <code className="min-w-0 flex-1 break-all font-mono text-[13px]">{show ? generated : masked}</code>
            <Button size="icon" variant="ghost" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide key" : "Show key"}>{show ? <EyeOff /> : <Eye />}</Button>
            <Button size="sm" variant={copied ? "outline" : "default"} onClick={copy}>{copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}</Button>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-[hsl(var(--risky)/0.3)] bg-[hsl(var(--risky)/0.06)] p-3 text-xs text-muted-foreground">
            <TriangleAlert className="mt-px size-4 shrink-0 text-[hsl(var(--risky))]" />
            Preview only — API keys aren&apos;t stored by the backend yet, so this secret won&apos;t authenticate requests.
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) createKey(); }}>
          <Field label="Key name" htmlFor="key-name" hint="e.g. Production, Staging, Zapier">
            <div className="relative">
              <Key className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Production" className="pl-9" autoFocus autoComplete="off" maxLength={60} />
            </div>
          </Field>
        </form>
      )}

      <DialogFooter className="border-t border-border pt-4">
        {generated ? (
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={!name.trim() || working} onClick={createKey}>
              {working ? <Loader2 className="animate-spin" /> : <KeyRound />} Generate key
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}

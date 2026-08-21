"use client";
import * as React from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Trash2, Loader2, ShieldCheck, Server, Zap, Globe } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { getProxyConfig, setProxyConfig, testProxies, type ProxyConfigInput } from "@/lib/api/client";
import { PROXY_TYPES, ROTATION_STRATEGIES, type ProxyConfig, type ProxyHealth, type ProxyType, type RotationStrategy } from "@/lib/leads/collect-types";

interface EditProxy {
  id?: string; label: string; host: string; port: number; type: ProxyType;
  username: string; password: string; country: string; enabled: boolean;
  status: ProxyHealth; lastLatencyMs?: number; hasAuth?: boolean; exitIp?: string;
}

const HEALTH_META: Record<ProxyHealth, { label: string; className: string }> = {
  untested: { label: "Untested", className: "bg-muted text-muted-foreground" },
  healthy: { label: "Healthy", className: "bg-valid/12 text-[hsl(var(--valid))]" },
  slow: { label: "Slow", className: "bg-risky/12 text-[hsl(var(--risky))]" },
  dead: { label: "Dead", className: "bg-invalid/12 text-[hsl(var(--invalid))]" },
};

const ROTATION_LABEL: Record<RotationStrategy, string> = {
  round_robin: "Round-robin", random: "Random", sticky_per_domain: "Sticky per domain",
};

export function ProxySettings({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["proxy-config"], queryFn: getProxyConfig, enabled: open });

  const [enabled, setEnabled] = React.useState(false);
  const [rotation, setRotation] = React.useState<RotationStrategy>("round_robin");
  const [concurrency, setConcurrency] = React.useState(3);
  const [delayMs, setDelayMs] = React.useState(800);
  const [backoffMs, setBackoffMs] = React.useState(2000);
  const [maxRetries, setMaxRetries] = React.useState(2);
  const [rows, setRows] = React.useState<EditProxy[]>([]);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [paste, setPaste] = React.useState("");
  const [rotatingEnabled, setRotatingEnabled] = React.useState(false);
  const [rotatingEndpoint, setRotatingEndpoint] = React.useState("");

  const rotatingActive = data?.rotating?.active ?? false;
  const rotatingEditable = data?.rotating?.editable ?? true;

  const hydrate = React.useCallback((cfg: ProxyConfig) => {
    setEnabled(cfg.enabled); setRotation(cfg.rotation); setConcurrency(cfg.concurrency);
    setDelayMs(cfg.delayMs); setBackoffMs(cfg.backoffMs); setMaxRetries(cfg.maxRetries);
    setRows(cfg.proxies.map((p) => ({ ...p, username: p.username ?? "", password: "", country: p.country ?? "" })));
    setRotatingEnabled(cfg.rotating?.active ?? false);
    setRotatingEndpoint(cfg.rotating?.endpoint ?? "");
  }, []);
  React.useEffect(() => { if (data) hydrate(data); }, [data, hydrate]);

  const payload = (): ProxyConfigInput => ({
    enabled, rotation, concurrency, delayMs, backoffMs, maxRetries,
    proxies: rows.map((r) => ({ id: r.id, label: r.label, host: r.host, port: Number(r.port) || 0, type: r.type, username: r.username || undefined, password: r.password || undefined, country: r.country || undefined, enabled: r.enabled })),
    rotating: { enabled: rotatingEnabled, endpoint: rotatingEndpoint || undefined },
  });

  const save = useMutation({ mutationFn: () => setProxyConfig(payload()), onSuccess: (cfg) => { hydrate(cfg); toast({ variant: "success", title: "Proxy settings saved" }); }, onError: () => toast({ variant: "error", title: "Could not save" }) });
  const test = useMutation({
    mutationFn: async () => { await setProxyConfig(payload()); return testProxies(); },
    onSuccess: (cfg) => { hydrate(cfg); const healthy = cfg.proxies.filter((p) => p.status === "healthy").length; toast({ variant: "success", title: "Proxies tested", description: `${healthy}/${cfg.proxies.length} healthy.` }); },
    onError: () => toast({ variant: "error", title: "Test failed" }),
  });

  const addRow = () => setRows((r) => [...r, { label: "", host: "", port: 8080, type: "http", username: "", password: "", country: "", enabled: true, status: "untested" }]);
  const addPasted = () => {
    const parsed = parseProxyLines(paste);
    if (!parsed.length) { toast({ variant: "error", title: "No valid proxies found", description: "Use host:port:user:pass per line." }); return; }
    setRows((r) => [...r, ...parsed]);
    setPaste(""); setPasteOpen(false);
    toast({ variant: "success", title: `${parsed.length} ${parsed.length === 1 ? "proxy" : "proxies"} added`, description: "Save, then test to verify." });
  };
  const setRow = (i: number, patch: Partial<EditProxy>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const removeRow = (i: number) => setRows((r) => r.filter((_, j) => j !== i));

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-3xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Server className="size-5 text-primary" /> Proxy configuration</DialogTitle>
        <DialogDescription>Route company collection through a rotating proxy pool to avoid rate limits while crawling multiple sources.</DialogDescription>
      </DialogHeader>

      {isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto size-5 animate-spin" /></div>
      ) : (
        <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
          {/* Rotating residential (preferred) */}
          <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <Globe className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    Rotating residential
                    {rotatingActive
                      ? <span className="rounded-full bg-[hsl(var(--valid))]/15 px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--valid))]">Active</span>
                      : <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Off</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">Fresh residential IP per request (80M+ pool) — never rate-limited. When on, this overrides the static pool below.</p>
                </div>
              </div>
              <Switch checked={rotatingEnabled} disabled={!rotatingEditable} onCheckedChange={setRotatingEnabled} />
            </div>
            <Input
              className="mt-2 font-mono text-xs"
              value={rotatingEndpoint}
              disabled={!rotatingEditable}
              onChange={(e) => setRotatingEndpoint(e.target.value)}
              placeholder="http://user-rotate:pass@p.webshare.io:80"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {rotatingEditable
                ? "Paste your Webshare rotating/backbone endpoint. Password is masked — leave it to keep the saved one."
                : "Locked by the CRAWLER_ROTATING_PROXY environment variable."}
            </p>
          </div>

          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Static proxy pool{rotatingActive ? " · fallback (used only when rotating is off)" : ""}
          </p>
          <div className={cn("space-y-5", rotatingActive && "opacity-60")}>
          {/* Global toggle + strategy */}
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className={cn("size-4", enabled ? "text-[hsl(var(--valid))]" : "text-muted-foreground")} />
              <div>
                <p className="text-sm font-medium">Route collection through proxies</p>
                <p className="text-xs text-muted-foreground">When off, requests go direct and get rate-limited far more.</p>
              </div>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Rotation">
              <Select value={rotation} onChange={(e) => setRotation(e.target.value as RotationStrategy)}>
                {ROTATION_STRATEGIES.map((s) => <option key={s} value={s}>{ROTATION_LABEL[s]}</option>)}
              </Select>
            </Field>
            <Field label="Concurrency"><Input type="number" min={1} max={20} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} /></Field>
            <Field label="Delay (ms)"><Input type="number" min={0} value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value))} /></Field>
            <Field label="Backoff (ms)"><Input type="number" min={0} value={backoffMs} onChange={(e) => setBackoffMs(Number(e.target.value))} /></Field>
            <Field label="Max retries"><Input type="number" min={0} max={5} value={maxRetries} onChange={(e) => setMaxRetries(Number(e.target.value))} /></Field>
          </div>

          {/* Proxy pool */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Proxy pool ({rows.length})</p>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setPasteOpen((o) => !o)}>Paste list</Button>
                <Button size="sm" variant="outline" onClick={addRow}><Plus className="size-4" /> Add proxy</Button>
              </div>
            </div>
            {pasteOpen && (
              <div className="mb-2 rounded-lg border bg-muted/20 p-2.5">
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={4}
                  placeholder={"Paste one per line — Webshare format:\n31.59.20.176:6754:ghftyooq:3pu60o6w995p\nor  user:pass@host:port  ·  host:port"}
                  className="w-full rounded-md border border-input bg-card p-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => { setPasteOpen(false); setPaste(""); }}>Cancel</Button>
                  <Button size="sm" onClick={addPasted}>Add proxies</Button>
                </div>
              </div>
            )}
            {rows.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">No proxies yet. Add one to enable rotation.</p>
            ) : (
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={i} className="rounded-lg border p-2.5">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                      {/* Row 1 — connection */}
                      <Input className="sm:col-span-3" placeholder="Label (e.g. us-1)" value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} />
                      <Input className="sm:col-span-4" placeholder="Host / IP" value={r.host} onChange={(e) => setRow(i, { host: e.target.value })} />
                      <Input className="sm:col-span-2" type="number" placeholder="Port" value={r.port} onChange={(e) => setRow(i, { port: Number(e.target.value) })} />
                      {/* Wrap in a grid child so col-span applies (Select puts className on the inner <select>, not the wrapper). */}
                      <div className="col-span-2 sm:col-span-3">
                        <Select value={r.type} onChange={(e) => setRow(i, { type: e.target.value as ProxyType })}>
                          {PROXY_TYPES.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                        </Select>
                      </div>
                      {/* Row 2 — auth + status + controls */}
                      <Input className="sm:col-span-3" placeholder="Username (optional)" value={r.username} onChange={(e) => setRow(i, { username: e.target.value })} />
                      <Input className="sm:col-span-3" type="password" placeholder={r.hasAuth ? "•••••• (unchanged)" : "Password (optional)"} value={r.password} onChange={(e) => setRow(i, { password: e.target.value })} />
                      <Input className="sm:col-span-2" placeholder="Country" value={r.country} onChange={(e) => setRow(i, { country: e.target.value })} />
                      <div className="col-span-2 flex min-w-0 items-center justify-end gap-2 sm:col-span-4">
                        <span className={cn("min-w-0 truncate rounded-full px-2 py-0.5 text-[10px] font-medium", HEALTH_META[r.status].className)} title={r.exitIp ? `Exit IP ${r.exitIp}` : undefined}>{HEALTH_META[r.status].label}{r.lastLatencyMs ? ` ${r.lastLatencyMs}ms` : ""}{r.exitIp ? ` · ${r.exitIp}` : ""}</span>
                        <Switch checked={r.enabled} onCheckedChange={(v) => setRow(i, { enabled: v })} />
                        <button onClick={() => removeRow(i)} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-[hsl(var(--invalid))]" aria-label="Remove"><Trash2 className="size-4" /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>
        </div>
      )}

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        <Button variant="outline" disabled={test.isPending || save.isPending} onClick={() => test.mutate()}>{test.isPending ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />} Save & test</Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="size-4 animate-spin" /> : "Save"}</Button>
      </DialogFooter>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}

/** Parse pasted proxy lines: `host:port:user:pass`, `host:port`, or `[scheme://]user:pass@host:port`. */
function parseProxyLines(text: string): EditProxy[] {
  const out: EditProxy[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let host = "", port = 0, username = "", password = "", type: ProxyType = "http";
    const url = line.match(/^(?:(https?|socks5h?):\/\/)?(?:([^:@\s]+):([^:@\s]+)@)?([\w.-]+):(\d{2,5})\/?$/i);
    if (url) {
      if (url[1]) type = url[1].toLowerCase().startsWith("socks") ? "socks5" : (url[1].toLowerCase() as ProxyType);
      username = url[2] ?? ""; password = url[3] ?? ""; host = url[4]; port = Number(url[5]);
    } else {
      const parts = line.split(/[\s,:]+/).filter(Boolean);
      if (parts.length >= 2 && /^\d{2,5}$/.test(parts[1])) {
        host = parts[0]; port = Number(parts[1]); username = parts[2] ?? ""; password = parts[3] ?? "";
      }
    }
    if (host && port) out.push({ label: host, host, port, type, username, password, country: "", enabled: true, status: "untested" });
  }
  return out;
}

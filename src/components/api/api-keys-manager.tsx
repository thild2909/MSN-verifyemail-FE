"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Copy, Key, Webhook as WebhookIcon, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { getApiKeys, getWebhooks, getWebhookDeliveries } from "@/lib/api/client";
import { WEBHOOK_EVENTS } from "@/lib/types";
import { useToast } from "@/components/ui/toast";
import { cn, formatNumber, formatDate, formatDateTime } from "@/lib/utils";

export function ApiKeysManager() {
  const { data: keys } = useQuery({ queryKey: ["apiKeys"], queryFn: getApiKeys });
  const { data: webhooks } = useQuery({ queryKey: ["webhooks"], queryFn: getWebhooks });
  const { data: deliveries } = useQuery({ queryKey: ["webhookDeliveries"], queryFn: getWebhookDeliveries });
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [generated, setGenerated] = React.useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = React.useState(webhooks?.[0]?.url ?? "https://app.mindsupernova.com/webhooks/email-verification");
  const [events, setEvents] = React.useState<Record<string, boolean>>(
    Object.fromEntries(WEBHOOK_EVENTS.map((e) => [e, webhooks?.[0]?.events.includes(e) ?? false])),
  );

  const createKey = () => {
    const secret = "sk_live_" + Array.from({ length: 32 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join("");
    setGenerated(secret);
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    toast({ variant: "success", title: "Copied to clipboard" });
  };

  return (
    <div className="space-y-6">
      {/* Keys */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Key className="size-4 text-primary" /> API keys</CardTitle>
            <CardDescription>Create scoped keys for server-to-server verification.</CardDescription>
          </div>
          <Button size="sm" onClick={() => { setCreateOpen(true); setGenerated(null); setNewName(""); }}>
            <Plus className="size-4" /> Create API key
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead>Key</TableHead><TableHead>Created</TableHead>
                <TableHead>Last used</TableHead><TableHead className="text-right">Requests</TableHead>
                <TableHead>Status</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(keys ?? []).map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{k.maskedKey}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(k.createdAt)}</TableCell>
                  <TableCell className="text-muted-foreground">{k.lastUsedAt ? formatDate(k.lastUsedAt) : "Never"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(k.requests)}</TableCell>
                  <TableCell><Badge variant={k.status === "active" ? "success" : "muted"}>{k.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    {k.status === "active" && (
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => toast({ variant: "warning", title: "Key revoked", description: k.name })}>
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Webhooks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><WebhookIcon className="size-4 text-primary" /> Webhooks</CardTitle>
          <CardDescription>Receive signed events with automatic retries.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label>Endpoint URL</Label>
            <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} className="font-mono text-sm" />
          </div>
          <div className="space-y-2">
            <Label>Events</Label>
            {WEBHOOK_EVENTS.map((ev) => (
              <div key={ev} className="flex items-center justify-between rounded-lg border p-3">
                <span className="font-mono text-sm">{ev}</span>
                <Switch checked={events[ev]} onCheckedChange={(v) => setEvents((s) => ({ ...s, [ev]: v }))} />
              </div>
            ))}
          </div>
          <Button onClick={() => toast({ variant: "success", title: "Webhook saved" })}>Save webhook</Button>

          {/* Delivery log */}
          <div>
            <p className="mb-2 text-sm font-medium">Recent deliveries</p>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Event</TableHead><TableHead>Response</TableHead><TableHead>Status</TableHead><TableHead>Time</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(deliveries ?? []).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs">{d.event}</TableCell>
                    <TableCell className="tabular-nums">{d.responseCode}</TableCell>
                    <TableCell>
                      <Badge variant={d.status === "success" ? "success" : d.status === "retrying" ? "warning" : "destructive"}>{d.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(d.attemptedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Create key dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
          <DialogDescription>{generated ? "Copy your key now — it won't be shown again." : "Give your key a recognizable name."}</DialogDescription>
        </DialogHeader>
        {generated ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
            <Check className="size-4 shrink-0 text-[hsl(var(--valid))]" />
            <code className="flex-1 break-all font-mono text-sm">{generated}</code>
            <Button size="icon" variant="ghost" onClick={() => copy(generated)}><Copy className="size-4" /></Button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label>Key name</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Production" autoFocus />
          </div>
        )}
        <DialogFooter>
          {generated ? (
            <Button onClick={() => { setCreateOpen(false); toast({ variant: "success", title: "API key created" }); }}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button disabled={!newName.trim()} onClick={createKey}>Generate key</Button>
            </>
          )}
        </DialogFooter>
      </Dialog>
    </div>
  );
}

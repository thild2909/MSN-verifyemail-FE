"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Plug, Check, ArrowRight, Lock } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { getIntegrations } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";
import type { Integration } from "@/lib/types";

const FLOW = ["Connect account", "Authorize", "Select list", "Import contacts", "Verify", "Export cleaned list"];

export default function IntegrationsPage() {
  const { data } = useQuery({ queryKey: ["integrations"], queryFn: getIntegrations });
  const [connecting, setConnecting] = React.useState<Integration | null>(null);
  const { toast } = useToast();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        subtitle="Import lists straight from your ESP, verify, and sync clean contacts back."
      />

      <div className="flex items-start gap-3 rounded-xl border bg-accent/40 p-4 text-sm">
        <Lock className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-accent-foreground">
          Credentials are encrypted at rest and never exposed to the browser. API keys and secrets are
          stored server-side only.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(data ?? []).map((int) => (
          <Card key={int.id} className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-sm font-bold uppercase">{int.name.slice(0, 2)}</span>
                <div>
                  <p className="font-semibold">{int.name}</p>
                  {int.connected && int.lastSyncedAt && (
                    <p className="text-xs text-muted-foreground">Synced {formatDate(int.lastSyncedAt)}</p>
                  )}
                </div>
              </div>
              {int.connected && <Badge variant="success"><Check className="size-3" /> Connected</Badge>}
            </div>
            <div className="mt-4">
              {int.connected ? (
                <Button variant="outline" size="sm" className="w-full" onClick={() => toast({ variant: "info", title: `${int.name} disconnected` })}>
                  Disconnect
                </Button>
              ) : (
                <Button size="sm" className="w-full" onClick={() => setConnecting(int)}>
                  <Plug className="size-4" /> Connect
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={!!connecting} onOpenChange={(o) => !o && setConnecting(null)}>
        <DialogHeader>
          <DialogTitle>Connect {connecting?.name}</DialogTitle>
          <DialogDescription>You&apos;ll be redirected to authorize access, then choose a list to import.</DialogDescription>
        </DialogHeader>
        <ol className="space-y-2">
          {FLOW.map((step, i) => (
            <li key={step} className="flex items-center gap-3 text-sm">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
              {step}
              {i < FLOW.length - 1 && <ArrowRight className="ml-auto size-3.5 text-muted-foreground" />}
            </li>
          ))}
        </ol>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConnecting(null)}>Cancel</Button>
          <Button onClick={() => { toast({ variant: "success", title: `${connecting?.name} connected` }); setConnecting(null); }}>
            Authorize
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

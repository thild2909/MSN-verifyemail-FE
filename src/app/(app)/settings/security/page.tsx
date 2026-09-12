"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Smartphone, Monitor, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getSessions, revokeSession, revokeOtherSessions } from "@/lib/api/client";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function SecuritySettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [twoFa, setTwoFa] = React.useState(true);

  const { data: sessions, isLoading } = useQuery({ queryKey: ["sessions"], queryFn: getSessions });

  const revokeOne = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
      toast({ variant: "success", title: "Session revoked" });
    },
    onError: (e) => toast({ variant: "error", title: "Could not revoke session", description: e instanceof Error ? e.message : undefined }),
  });

  const revokeOthers = useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
      toast({ variant: "success", title: n > 0 ? `Signed out ${n} other device${n > 1 ? "s" : ""}` : "No other devices" });
    },
    onError: (e) => toast({ variant: "error", title: "Could not sign out devices", description: e instanceof Error ? e.message : undefined }),
  });

  const otherCount = (sessions ?? []).filter((s) => !s.current).length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Password</CardTitle>
          <CardDescription>Use a strong, unique password.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Current password</Label><PasswordInput placeholder="••••••••" /></div>
            <div />
            <div className="space-y-1.5"><Label>New password</Label><PasswordInput placeholder="••••••••" /></div>
            <div className="space-y-1.5"><Label>Confirm new password</Label><PasswordInput placeholder="••••••••" /></div>
          </div>
          <Button onClick={() => toast({ variant: "success", title: "Password updated" })}>Update password</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Two-factor authentication</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-5 text-[hsl(var(--valid))]" />
              <div>
                <p className="text-sm font-medium">Authenticator app</p>
                <p className="text-xs text-muted-foreground">{twoFa ? "Enabled" : "Add an extra layer of security"}</p>
              </div>
            </div>
            <Switch checked={twoFa} onCheckedChange={(v) => { setTwoFa(v); toast({ variant: "info", title: v ? "2FA enabled" : "2FA disabled" }); }} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Active sessions</CardTitle>
            <CardDescription>Devices currently signed in to your account.</CardDescription>
          </div>
          {otherCount > 0 && (
            <Button variant="outline" size="sm" disabled={revokeOthers.isPending} onClick={async () => { if (await confirm({ title: "Sign out other devices?", description: "All other sessions will be signed out immediately. This device stays signed in.", confirmText: "Sign out" })) revokeOthers.mutate(); }}>
              {revokeOthers.isPending && <Loader2 className="size-4 animate-spin" />}
              Sign out other devices
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (sessions ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No active sessions.</p>
          ) : (
            (sessions ?? []).map((s) => {
              const Icon = s.mobile ? Smartphone : Monitor;
              return (
                <div key={s.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    <Icon className="size-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{s.device}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.ip} · {s.current ? "Active now" : `Last active ${timeAgo(s.lastSeenAt)}`}
                      </p>
                    </div>
                  </div>
                  {s.current ? (
                    <Badge variant="success">This device</Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={revokeOne.isPending}
                      onClick={async () => { if (await confirm({ title: "Revoke this session?", description: `${s.device} will be signed out immediately.`, confirmText: "Revoke" })) revokeOne.mutate(s.id); }}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

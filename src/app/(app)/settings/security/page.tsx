"use client";
import * as React from "react";
import { ShieldCheck, Smartphone, Monitor } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

const SESSIONS = [
  { device: "Chrome · Windows", location: "Sydney, AU", current: true, icon: Monitor },
  { device: "Safari · iPhone", location: "Sydney, AU", current: false, icon: Smartphone },
];

export default function SecuritySettingsPage() {
  const { toast } = useToast();
  const [twoFa, setTwoFa] = React.useState(true);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Password</CardTitle>
          <CardDescription>Use a strong, unique password.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Current password</Label><Input type="password" placeholder="••••••••" /></div>
            <div />
            <div className="space-y-1.5"><Label>New password</Label><Input type="password" placeholder="••••••••" /></div>
            <div className="space-y-1.5"><Label>Confirm new password</Label><Input type="password" placeholder="••••••••" /></div>
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
        <CardHeader><CardTitle className="text-base">Active sessions</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {SESSIONS.map((s) => (
            <div key={s.device} className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <s.icon className="size-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{s.device}</p>
                  <p className="text-xs text-muted-foreground">{s.location}</p>
                </div>
              </div>
              {s.current ? (
                <Badge variant="success">This device</Badge>
              ) : (
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => toast({ variant: "warning", title: "Session revoked" })}>
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

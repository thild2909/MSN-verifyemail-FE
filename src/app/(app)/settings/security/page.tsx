"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Smartphone, Monitor, Loader2, KeyRound, LaptopMinimal, LogOut, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SettingsCard, Field, Pill, IconTile } from "@/components/settings/settings-ui";
import { getSessions, revokeSession, revokeOtherSessions } from "@/lib/api/client";
import { cn } from "@/lib/utils";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const RULES = [
  { label: "At least 8 characters", test: (v: string) => v.length >= 8 },
  { label: "Upper & lower case", test: (v: string) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { label: "A number", test: (v: string) => /\d/.test(v) },
  { label: "A symbol", test: (v: string) => /[^A-Za-z0-9]/.test(v) },
];

export default function SecuritySettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [twoFa, setTwoFa] = React.useState(true);
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [again, setAgain] = React.useState("");

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

  const list = sessions ?? [];
  const otherCount = list.filter((s) => !s.current).length;
  const strength = RULES.filter((r) => r.test(next)).length;
  const mismatch = again.length > 0 && again !== next;
  const canSubmit = current.length > 0 && strength >= 3 && next.length >= 8 && again === next;

  return (
    <div className="space-y-5">
      {/* Overview */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: KeyRound, tone: "brand" as const, label: "Password", value: "Set" },
          { icon: ShieldCheck, tone: twoFa ? ("valid" as const) : ("risky" as const), label: "Two-factor", value: twoFa ? "On" : "Off" },
          { icon: LaptopMinimal, tone: "sky" as const, label: "Signed-in devices", value: isLoading ? "…" : String(list.length) },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 shadow-card">
            <IconTile icon={s.icon} tone={s.tone} />
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-[15px] font-semibold tabular-nums">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Password */}
      <SettingsCard
        id="password"
        icon={KeyRound}
        title="Password"
        description="Use a strong, unique password you don't use anywhere else."
        footer={
          <Button
            disabled={!canSubmit}
            onClick={() => {
              setCurrent(""); setNext(""); setAgain("");
              toast({ variant: "success", title: "Password updated" });
            }}
          >
            Update password
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Current password" htmlFor="pw-current" className="sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
            <PasswordInput id="pw-current" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••" />
          </Field>
          <Field label="New password" htmlFor="pw-new">
            <PasswordInput id="pw-new" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="••••••••" />
          </Field>
          <Field label="Confirm new password" htmlFor="pw-again" error={mismatch ? "Passwords don't match." : undefined}>
            <PasswordInput id="pw-again" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} placeholder="••••••••" />
          </Field>
        </div>

        {/* Strength */}
        <div className="mt-4 rounded-lg border border-border bg-surface/50 p-3">
          <div className="flex gap-1">
            {RULES.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors",
                  i < strength
                    ? strength <= 1 ? "bg-[hsl(var(--invalid))]" : strength <= 2 ? "bg-[hsl(var(--risky))]" : "bg-[hsl(var(--valid))]"
                    : "bg-border",
                )}
              />
            ))}
          </div>
          <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
            {RULES.map((r) => {
              const ok = r.test(next);
              return (
                <li key={r.label} className={cn("flex items-center gap-1.5 text-xs", ok ? "text-foreground" : "text-muted-foreground")}>
                  {ok ? <Check className="size-3.5 text-[hsl(var(--valid))]" /> : <X className="size-3.5 opacity-50" />}
                  {r.label}
                </li>
              );
            })}
          </ul>
        </div>
      </SettingsCard>

      {/* 2FA */}
      <SettingsCard
        id="two-factor"
        icon={ShieldCheck}
        tone="valid"
        title="Two-factor authentication"
        description="Require a code from your authenticator app at sign-in."
        aside={<Pill tone={twoFa ? "valid" : "muted"} dot>{twoFa ? "Enabled" : "Disabled"}</Pill>}
      >
        <div className="flex items-center gap-3 rounded-lg border border-border p-3">
          <IconTile icon={Smartphone} tone="muted" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Authenticator app</p>
            <p className="text-xs text-muted-foreground">{twoFa ? "Codes are required on every new sign-in." : "Add an extra layer of security to your account."}</p>
          </div>
          <Switch
            checked={twoFa}
            onCheckedChange={(v) => { setTwoFa(v); toast({ variant: "info", title: v ? "2FA enabled" : "2FA disabled" }); }}
          />
        </div>
      </SettingsCard>

      {/* Sessions */}
      <SettingsCard
        icon={LaptopMinimal}
        tone="sky"
        title="Active sessions"
        description="Devices currently signed in to your account."
        aside={
          otherCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={revokeOthers.isPending}
              onClick={async () => {
                if (await confirm({ title: "Sign out other devices?", description: "All other sessions will be signed out immediately. This device stays signed in.", confirmText: "Sign out" }))
                  revokeOthers.mutate();
              }}
            >
              {revokeOthers.isPending ? <Loader2 className="animate-spin" /> : <LogOut />}
              Sign out others
            </Button>
          )
        }
        bodyClassName="p-0"
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
        ) : list.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No active sessions.</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((s) => {
              const Icon = s.mobile ? Smartphone : Monitor;
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <IconTile icon={Icon} tone={s.current ? "valid" : "muted"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.device}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">{s.ip}</span> · {s.current ? "Active now" : `Last active ${timeAgo(s.lastSeenAt)}`}
                    </p>
                  </div>
                  {s.current ? (
                    <Pill tone="valid" dot>This device</Pill>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={revokeOne.isPending}
                      onClick={async () => {
                        if (await confirm({ title: "Revoke this session?", description: `${s.device} will be signed out immediately.`, confirmText: "Revoke" }))
                          revokeOne.mutate(s.id);
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SettingsCard>
    </div>
  );
}

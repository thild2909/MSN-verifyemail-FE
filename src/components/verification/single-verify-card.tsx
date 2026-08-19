"use client";
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { AtSign, Loader2, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "./status-badge";
import { ResultDetails } from "./result-details";
import { ScoreRing, scoreTone } from "@/components/common/score-ring";
import { verifyEmail, type VerifyResponse } from "@/lib/api/client";
import { CREDIT_COSTS } from "@/lib/credit-config";
import { useToast } from "@/components/ui/toast";

export function SingleVerifyCard() {
  const [email, setEmail] = React.useState("");
  const [response, setResponse] = React.useState<VerifyResponse | null>(null);
  const { toast } = useToast();

  const verify = useMutation({
    mutationFn: () => verifyEmail(email.trim()),
    onSuccess: (res) => {
      setResponse(res);
      if (res.provider === "mock") {
        toast({
          variant: "warning",
          title: "Backend offline — simulated result",
          description: "Start the verification backend for real SMTP checks.",
        });
      } else {
        toast({ variant: "success", title: "Verification complete", description: `${res.result.email} → ${res.result.status}` });
      }
    },
    onError: () => toast({ variant: "error", title: "Verification failed", description: "Please try again." }),
  });

  const result = response?.result ?? null;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    verify.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          Single Email Verification
        </CardTitle>
        <CardDescription>
          Real SMTP + MX verification. Costs {CREDIT_COSTS.single_verification} credit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <AtSign className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email to check"
                className="pl-9"
              />
            </div>
            <Button type="submit" disabled={verify.isPending || !email.trim()} className="sm:w-28">
              {verify.isPending ? <Loader2 className="size-4 animate-spin" /> : "Verify"}
            </Button>
          </div>
        </form>

        {verify.isPending && (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Running live verification (syntax → MX → SMTP)…
          </div>
        )}

        {result && !verify.isPending && (
          <div className="animate-fade-in space-y-4 rounded-xl border bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{result.email}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <StatusBadge status={result.status} />
                  {response?.provider === "reacher" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-[hsl(var(--valid))]">
                      <Wifi className="size-3" /> Live
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <WifiOff className="size-3" /> Simulated
                    </span>
                  )}
                </div>
              </div>
              <ScoreRing score={result.score} tone={scoreTone(result.score)} />
            </div>

            <div className="rounded-lg bg-accent/60 px-3 py-2 text-sm text-accent-foreground">
              {result.suggestedAction}
            </div>

            <ResultDetails result={result} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

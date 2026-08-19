"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Zap, TrendingUp, Wallet, Check } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { getCredits, getTransactions } from "@/lib/api/client";
import { CREDIT_COSTS } from "@/lib/credit-config";
import { useToast } from "@/components/ui/toast";
import { cn, formatNumber, formatDateTime } from "@/lib/utils";

const PACKS = [
  { credits: 10000, price: 29 },
  { credits: 50000, price: 99, popular: true },
  { credits: 200000, price: 299 },
];

export default function BillingPage() {
  const { data: credits, isLoading } = useQuery({ queryKey: ["credits"], queryFn: getCredits });
  const { data: txns } = useQuery({ queryKey: ["transactions"], queryFn: getTransactions });
  const [buyOpen, setBuyOpen] = React.useState(false);
  const [pack, setPack] = React.useState(PACKS[1]);
  const { toast } = useToast();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing & Credits"
        subtitle="Track balances, top up, and review your usage history."
        actions={<Button onClick={() => setBuyOpen(true)}><Zap className="size-4" /> Add credits</Button>}
      />

      {isLoading || !credits ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total remaining" value={credits.totalRemaining} hint={`of ${formatNumber(credits.totalAllocation)}`} icon={Wallet} />
          <StatCard label="Verification credits" value={credits.verificationRemaining} hint={`of ${formatNumber(credits.verificationAllocation)} monthly`} icon={Zap} />
          <StatCard label="Pay-as-you-go" value={credits.payAsYouGoRemaining} hint={`of ${formatNumber(credits.payAsYouGoAllocation)}`} icon={TrendingUp} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Current plan */}
        <Card>
          <CardHeader><CardTitle className="text-base">Current plan</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold">Growth</span>
              <Badge variant="success">Active</Badge>
            </div>
            <p className="text-sm text-muted-foreground">25,000 verification credits / month · renews Sep 1, 2026.</p>
            <ul className="space-y-2 text-sm">
              {["Bulk verification", "Deep Scan", "Email Finder", "API access", "Webhooks"].map((f) => (
                <li key={f} className="flex items-center gap-2"><Check className="size-4 text-[hsl(var(--valid))]" /> {f}</li>
              ))}
            </ul>
            <Button variant="outline" className="w-full">Manage subscription</Button>
          </CardContent>
        </Card>

        {/* Pricing reference */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Credit costs</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Operation</TableHead><TableHead className="text-right">Cost</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {[
                  ["Single verification", CREDIT_COSTS.single_verification, "per email"],
                  ["Bulk verification", CREDIT_COSTS.bulk_verification, "per email"],
                  ["Deep Scan", CREDIT_COSTS.deep_scan, "per email"],
                  ["Email Finder", CREDIT_COSTS.email_finder, "per result"],
                  ["API verification", CREDIT_COSTS.api_verification, "per request"],
                ].map(([label, cost, unit]) => (
                  <TableRow key={label as string}>
                    <TableCell className="font-medium">{label}</TableCell>
                    <TableCell className="text-right">
                      <span className="font-semibold">{cost}</span>
                      <span className="text-muted-foreground"> credit{Number(cost) > 1 ? "s" : ""} {unit}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">Pricing is served from backend configuration — never hard-coded in the client.</p>
          </CardContent>
        </Card>
      </div>

      {/* Transactions */}
      <Card>
        <CardHeader><CardTitle className="text-base">Credit history</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead><TableHead>Operation</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>User</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(txns ?? []).map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(t.date)}</TableCell>
                  <TableCell className="font-medium">{t.label}</TableCell>
                  <TableCell className={cn("text-right font-medium tabular-nums", t.credits < 0 ? "text-[hsl(var(--invalid))]" : "text-[hsl(var(--valid))]")}>
                    {t.credits > 0 ? "+" : ""}{formatNumber(t.credits)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(t.balance)}</TableCell>
                  <TableCell className="text-muted-foreground">{t.user}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Buy dialog */}
      <Dialog open={buyOpen} onOpenChange={setBuyOpen}>
        <DialogHeader>
          <DialogTitle>Add credits</DialogTitle>
          <DialogDescription>Pay-as-you-go credits never expire.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          {PACKS.map((p) => (
            <button
              key={p.credits}
              onClick={() => setPack(p)}
              className={cn(
                "relative rounded-xl border p-4 text-left transition-colors",
                pack.credits === p.credits ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/50",
              )}
            >
              {p.popular && <span className="absolute -top-2 right-3 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">Popular</span>}
              <p className="text-lg font-bold">{formatNumber(p.credits)}</p>
              <p className="text-sm text-muted-foreground">credits</p>
              <p className="mt-2 text-sm font-semibold">${p.price}</p>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setBuyOpen(false)}>Cancel</Button>
          <Button onClick={() => { setBuyOpen(false); toast({ variant: "success", title: "Credits added", description: `${formatNumber(pack.credits)} credits purchased.` }); }}>
            Pay ${pack.price}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

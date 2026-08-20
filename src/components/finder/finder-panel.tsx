"use client";
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, Loader2, Building2, User, Download, CheckCircle2, Copy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/verification/status-badge";
import { findPersonEmail, findEmailsByDomain, verifyEmail } from "@/lib/api/client";
import { FINDER_STATE_META, scoreIsMeaningful } from "@/lib/finder/state-ui";
import { Loader2 as Spinner } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { FinderOutcome, FinderResult, FinderState } from "@/lib/types";

type Mode = "person" | "domain";

const STATE_UI = FINDER_STATE_META;

function ScoreBar({ value }: { value: number }) {
  const tone = value >= 85 ? "bg-[hsl(var(--valid))]" : value >= 60 ? "bg-[hsl(var(--risky))]" : "bg-muted-foreground";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-sm font-medium tabular-nums">{value}%</span>
    </div>
  );
}

export function FinderPanel() {
  const [mode, setMode] = React.useState<Mode>("person");
  const [person, setPerson] = React.useState({ firstName: "", lastName: "", domain: "" });
  const [domain, setDomain] = React.useState("");
  const [results, setResults] = React.useState<FinderResult[]>([]);
  const { toast } = useToast();

  const [verifyingIds, setVerifyingIds] = React.useState<Set<string>>(new Set());
  const [finderState, setFinderState] = React.useState<FinderState | null>(null);

  const markVerifying = (id: string, on: boolean) =>
    setVerifyingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Toast + banner copy for a server-side person-finder outcome. */
  const announceOutcome = (o: FinderOutcome) => {
    const savings = o.fromCache
      ? " (from cache)"
      : o.skipped > 0
        ? ` — skipped ${o.skipped} check${o.skipped === 1 ? "" : "s"}`
        : "";
    const copy: Record<FinderState, { variant: "success" | "info" | "warning"; title: string; description: string }> = {
      verified: { variant: "success", title: "Email found", description: `Verified the deliverable address${savings}.` },
      accept_all: { variant: "info", title: "Unverified", description: `Plausible but the backend couldn't confirm deliverability${savings}.` },
      no_mx: { variant: "warning", title: "No mail server", description: "This domain has no MX record and can't receive email." },
      not_found: { variant: "warning", title: "Email not found", description: `No mailbox could be confirmed for this person${savings}.` },
    };
    const c = copy[o.state];
    toast({ variant: c.variant, title: c.title, description: c.description });
  };

  const search = useMutation({
    mutationFn: async () => {
      if (mode === "person") {
        const outcome = await findPersonEmail(person);
        return { kind: "person" as const, outcome };
      }
      const contacts = await findEmailsByDomain(domain);
      return { kind: "domain" as const, contacts };
    },
    onSuccess: (data) => {
      if (data.kind === "person") {
        // The server already verified with early-exit — just show the winner.
        setResults([{ ...data.outcome.result, state: data.outcome.state }]);
        setFinderState(data.outcome.state);
        announceOutcome(data.outcome);
      } else {
        // Domain discovery also runs the server pipeline: each contact is
        // already resolved with its own verdict `state`.
        setFinderState(null);
        setResults(data.contacts);
        const found = data.contacts.filter((c) => c.state === "verified" || c.state === "accept_all").length;
        toast({
          variant: found > 0 ? "success" : "info",
          title: `${found} of ${data.contacts.length} contacts found`,
          description: found > 0 ? "Deliverable addresses are marked Verified." : "No mailbox could be confirmed on this domain.",
        });
      }
    },
  });

  const canSearch =
    mode === "person"
      ? person.firstName && person.lastName && person.domain
      : domain.trim().length > 0;

  /** Manual live re-verify of one row; mirrors the server's verdict rule. */
  const verifyRow = async (r: FinderResult) => {
    markVerifying(r.id, true);
    try {
      const { result } = await verifyEmail(r.email);
      const state: FinderState =
        result.status === "valid"
          ? "verified"
          : result.status !== "invalid" && result.score >= 60
            ? "accept_all"
            : "not_found";
      setResults((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: result.status, score: result.score, state } : x)));
      if (mode === "person") setFinderState(state);
    } catch {
      /* leave the row unchanged on error */
    } finally {
      markVerifying(r.id, false);
    }
  };

  const copy = (email: string) => {
    navigator.clipboard?.writeText(email);
    toast({ variant: "success", title: "Copied", description: email });
  };

  const exportCsv = () => {
    if (results.length === 0) return;
    const header = "email,score,status\n";
    const body = results.map((r) => `${r.email},${r.score},${r.status}`).join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "found-emails.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast({ variant: "success", title: "Exported to CSV", description: `${results.length} contacts.` });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Search form */}
      <Card className="lg:col-span-1">
        <CardContent className="p-5">
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            <button
              onClick={() => setMode("person")}
              className={cn("flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors", mode === "person" ? "bg-card shadow-sm" : "text-muted-foreground")}
            >
              <User className="size-4" /> By person
            </button>
            <button
              onClick={() => setMode("domain")}
              className={cn("flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors", mode === "domain" ? "bg-card shadow-sm" : "text-muted-foreground")}
            >
              <Building2 className="size-4" /> By domain
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canSearch) search.mutate();
            }}
            className="space-y-3"
          >
            {mode === "person" ? (
              <>
                <div className="space-y-1.5">
                  <Label>First name</Label>
                  <Input value={person.firstName} onChange={(e) => setPerson({ ...person, firstName: e.target.value })} placeholder="John" />
                </div>
                <div className="space-y-1.5">
                  <Label>Last name</Label>
                  <Input value={person.lastName} onChange={(e) => setPerson({ ...person, lastName: e.target.value })} placeholder="Smith" />
                </div>
                <div className="space-y-1.5">
                  <Label>Company / domain</Label>
                  <Input value={person.domain} onChange={(e) => setPerson({ ...person, domain: e.target.value })} placeholder="example.com" />
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label>Company domain</Label>
                <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" />
                <p className="text-xs text-muted-foreground">
                  Discovers publicly available business contacts. Private data is never scraped.
                </p>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={!canSearch || search.isPending}>
              {search.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              {mode === "person" ? "Find email" : "Find emails"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Results */}
      <div className="lg:col-span-2">
        {results.length === 0 && !search.isPending ? (
          <EmptyState
            icon={Search}
            title="Find professional emails"
            description="Enter a person's name and company domain — or just a domain — to discover possible business email addresses."
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between p-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {search.isPending ? (
                    <>
                      <Spinner className="size-3.5 animate-spin text-primary" />
                      {mode === "person" ? "Finding the best email…" : "Finding & verifying contacts…"}
                    </>
                  ) : mode === "person" ? (
                    finderState === "not_found" || finderState === "no_mx" ? "Result" : "Best match"
                  ) : (
                    `${results.length} contact${results.length === 1 ? "" : "s"}`
                  )}
                </p>
                {results.length > 0 && !search.isPending &&
                  !(mode === "person" && (finderState === "not_found" || finderState === "no_mx")) && (
                    <Button variant="outline" size="sm" onClick={exportCsv}>
                      <Download className="size-4" /> Export CSV
                    </Button>
                  )}
              </div>

              {mode === "person" && (finderState === "not_found" || finderState === "no_mx") && !search.isPending ? (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                  {React.createElement(STATE_UI[finderState].icon, { className: "size-8 text-muted-foreground" })}
                  <p className="text-sm font-semibold">{STATE_UI[finderState].label}</p>
                  <p className="max-w-sm text-xs text-muted-foreground">
                    {finderState === "no_mx"
                      ? `${person.domain} has no mail server, so it can't receive email.`
                      : `The backend couldn't confirm any mailbox for ${person.firstName} ${person.lastName} on this domain.`}
                  </p>
                  {finderState === "not_found" && results[0]?.email && (
                    <p className="text-xs text-muted-foreground">
                      Closest format (unverified): <span className="font-medium text-foreground">{results[0].email}</span>
                    </p>
                  )}
                </div>
              ) : (
              <>
              {mode === "person" && finderState && !search.isPending && (
                <div className={cn("mx-4 mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm", STATE_UI[finderState].className)}>
                  {React.createElement(STATE_UI[finderState].icon, { className: "size-4 shrink-0" })}
                  {STATE_UI[finderState].label}
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    {mode === "domain" && <TableHead>Name</TableHead>}
                    {mode === "domain" && <TableHead>Title</TableHead>}
                    <TableHead>Email</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {search.isPending
                    ? null
                    : results.map((r) => (
                        <TableRow key={r.id}>
                          {mode === "domain" && <TableCell className="font-medium">{r.name}</TableCell>}
                          {mode === "domain" && <TableCell className="text-muted-foreground">{r.jobTitle}</TableCell>}
                          <TableCell className={cn("font-medium", r.state && !scoreIsMeaningful(r.state) && "text-muted-foreground")}>
                            <div className="flex items-center gap-2">
                              <span>{r.email}</span>
                              {mode === "person" && r.bestGuess && (
                                <span className="rounded-full bg-[hsl(var(--valid))]/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--valid))]">
                                  Best guess
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {r.state && scoreIsMeaningful(r.state) ? (
                              <ScoreBar value={r.score} />
                            ) : (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {verifyingIds.has(r.id) ? (
                              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Spinner className="size-3 animate-spin" /> Verifying…
                              </span>
                            ) : r.state ? (
                              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", STATE_UI[r.state].className)}>
                                {React.createElement(STATE_UI[r.state].icon, { className: "size-3" })}
                                {STATE_UI[r.state].chip}
                              </span>
                            ) : r.status === "unverified" ? (
                              <span className="text-xs text-muted-foreground">Unverified</span>
                            ) : (
                              <StatusBadge status={r.status} />
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="icon" variant="ghost" onClick={() => copy(r.email)} aria-label="Copy">
                                <Copy className="size-4" />
                              </Button>
                              <Button size="sm" variant="ghost" disabled={verifyingIds.has(r.id)} onClick={() => verifyRow(r)}>
                                {verifyingIds.has(r.id) ? <Spinner className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Verify
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
              </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

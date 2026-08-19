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
import { findEmailsByPerson, findEmailsByDomain, verifyEmail } from "@/lib/api/client";
import { Loader2 as Spinner } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { FinderResult } from "@/lib/types";

type Mode = "person" | "domain";

function ConfidenceBar({ value }: { value: number }) {
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

  const search = useMutation({
    mutationFn: () =>
      mode === "person" ? findEmailsByPerson(person) : findEmailsByDomain(domain),
    onSuccess: (data) => setResults(data),
  });

  const [verifyingId, setVerifyingId] = React.useState<string | null>(null);

  const canSearch =
    mode === "person"
      ? person.firstName && person.lastName && person.domain
      : domain.trim().length > 0;

  const verifyRow = async (r: FinderResult) => {
    setVerifyingId(r.id);
    try {
      const { result, provider } = await verifyEmail(r.email);
      setResults((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: result.status } : x)));
      toast({
        variant: result.status === "valid" ? "success" : result.status === "invalid" ? "error" : "warning",
        title: `${result.email} → ${result.status}`,
        description: provider === "mock" ? "Simulated (backend offline)" : "Verified live",
      });
    } catch {
      toast({ variant: "error", title: "Verification failed", description: r.email });
    } finally {
      setVerifyingId(null);
    }
  };

  const copy = (email: string) => {
    navigator.clipboard?.writeText(email);
    toast({ variant: "success", title: "Copied", description: email });
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
                <p className="text-sm font-medium">
                  {search.isPending ? "Searching…" : `${results.length} possible email${results.length === 1 ? "" : "s"}`}
                </p>
                {results.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toast({ variant: "info", title: "Exported to CSV", description: `${results.length} contacts.` })}
                  >
                    <Download className="size-4" /> Export CSV
                  </Button>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    {mode === "domain" && <TableHead>Name</TableHead>}
                    {mode === "domain" && <TableHead>Title</TableHead>}
                    <TableHead>Email</TableHead>
                    <TableHead>Confidence</TableHead>
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
                          <TableCell className="font-medium">{r.email}</TableCell>
                          <TableCell><ConfidenceBar value={r.confidence} /></TableCell>
                          <TableCell>
                            {r.status === "unverified" ? (
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
                              <Button size="sm" variant="ghost" disabled={verifyingId === r.id} onClick={() => verifyRow(r)}>
                                {verifyingId === r.id ? <Spinner className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Verify
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

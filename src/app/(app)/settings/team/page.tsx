"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { getTeam } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import { initials } from "@/lib/utils";

const ROLE_PERMS: Record<string, string> = {
  Owner: "Full access including billing and org deletion.",
  Admin: "Manage users, lists, integrations, and API.",
  Member: "Upload lists, verify, use finder and API.",
  Viewer: "Read-only access to lists and results.",
};

export default function TeamSettingsPage() {
  const { data } = useQuery({ queryKey: ["team"], queryFn: getTeam });
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const { toast } = useToast();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Team members</CardTitle>
            <CardDescription>Invite teammates and manage their roles.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setInviteOpen(true)}><UserPlus className="size-4" /> Invite</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Member</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-semibold">{initials(m.name)}</span>
                      <div>
                        <p className="font-medium">{m.name}</p>
                        <p className="text-xs text-muted-foreground">{m.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant={m.role === "Owner" ? "default" : "muted"}>{m.role}</Badge></TableCell>
                  <TableCell><Badge variant={m.status === "active" ? "success" : "warning"}>{m.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Roles &amp; permissions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(ROLE_PERMS).map(([role, desc]) => (
            <div key={role} className="flex items-start gap-3 rounded-lg border p-3">
              <Badge variant="muted" className="mt-0.5">{role}</Badge>
              <span className="text-sm text-muted-foreground">{desc}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogHeader>
          <DialogTitle>Invite team member</DialogTitle>
          <DialogDescription>They&apos;ll receive an email to join your organization.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" placeholder="teammate@company.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select defaultValue="Member">
              <option>Admin</option><option>Member</option><option>Viewer</option>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
          <Button onClick={() => { setInviteOpen(false); toast({ variant: "success", title: "Invitation sent" }); }}>Send invite</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

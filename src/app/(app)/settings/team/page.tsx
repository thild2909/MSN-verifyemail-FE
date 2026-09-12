"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, MoreHorizontal, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { getMe, getUsers, createUser, updateUser, deleteUser } from "@/lib/api/client";
import type { AppUser, UserRole } from "@/lib/types";
import { initials } from "@/lib/utils";

const ROLE_PERMS: Record<UserRole, string> = {
  admin: "Full access: manage users, lists, verification, finder, and settings.",
  member: "Use verification, finder, lists, and leads. No user management.",
};

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

export default function UsersSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe });
  const { data: users, isLoading } = useQuery({ queryKey: ["users"], queryFn: getUsers });

  const [addOpen, setAddOpen] = React.useState(false);
  const [editUser, setEditUser] = React.useState<AppUser | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<AppUser | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["users"] });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Users</CardTitle>
            <CardDescription>Create accounts and manage roles and access.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus className="size-4" /> Add user
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <>
            {/* Mobile: user cards */}
            <div className="space-y-3 md:hidden">
              {(users ?? []).map((u) => {
                const isSelf = u.id === me?.id;
                return (
                  <div key={u.id} className="rounded-xl border p-3">
                    <div className="flex items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                        {initials(u.name || u.email)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {u.name || "—"}
                          {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                      </div>
                      <DropdownMenu
                        trigger={
                          <button className="-mr-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Actions">
                            <MoreHorizontal className="size-4" />
                          </button>
                        }
                      >
                        <DropdownItem onClick={() => setEditUser(u)}>Edit</DropdownItem>
                        <DropdownSeparator />
                        <DropdownItem destructive disabled={isSelf} onClick={() => !isSelf && setDeleteTarget(u)}>
                          Delete
                        </DropdownItem>
                      </DropdownMenu>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge variant={u.role === "admin" ? "default" : "muted"}>{u.role}</Badge>
                      <Badge variant={u.isActive ? "success" : "warning"}>{u.isActive ? "active" : "inactive"}</Badge>
                      <span className="ml-auto text-xs text-muted-foreground">{fmtDate(u.createdAt)}</span>
                    </div>
                  </div>
                );
              })}
              {(users ?? []).length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No users yet.</p>
              )}
            </div>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(users ?? []).map((u) => {
                  const isSelf = u.id === me?.id;
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                            {initials(u.name || u.email)}
                          </span>
                          <div>
                            <p className="font-medium">
                              {u.name || "—"}
                              {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                            </p>
                            <p className="text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.role === "admin" ? "default" : "muted"}>{u.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.isActive ? "success" : "warning"}>
                          {u.isActive ? "active" : "inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(u.createdAt)}</TableCell>
                      <TableCell>
                        <DropdownMenu
                          trigger={
                            <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Actions">
                              <MoreHorizontal className="size-4" />
                            </button>
                          }
                        >
                          <DropdownItem onClick={() => setEditUser(u)}>Edit</DropdownItem>
                          <DropdownSeparator />
                          <DropdownItem
                            destructive
                            disabled={isSelf}
                            onClick={() => !isSelf && setDeleteTarget(u)}
                          >
                            Delete
                          </DropdownItem>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(users ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      No users yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roles &amp; permissions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(Object.entries(ROLE_PERMS) as [UserRole, string][]).map(([role, desc]) => (
            <div key={role} className="flex items-start gap-3 rounded-lg border p-3">
              <Badge variant={role === "admin" ? "default" : "muted"} className="mt-0.5">
                {role}
              </Badge>
              <span className="text-sm text-muted-foreground">{desc}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <AddUserDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onDone={() => {
          invalidate();
          toast({ variant: "success", title: "User created" });
        }}
      />

      <EditUserDialog
        user={editUser}
        isSelf={editUser?.id === me?.id}
        onClose={() => setEditUser(null)}
        onDone={() => {
          invalidate();
          qc.invalidateQueries({ queryKey: ["me"] });
          toast({ variant: "success", title: "User updated" });
        }}
      />

      <DeleteUserDialog
        user={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDone={() => {
          invalidate();
          toast({ variant: "success", title: "User deleted" });
        }}
      />
    </div>
  );
}

/* ------------------------------- Add user ------------------------------- */

function AddUserDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<UserRole>("member");
  const [password, setPassword] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setEmail("");
      setName("");
      setRole("member");
      setPassword("");
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => createUser({ email: email.trim(), name: name.trim(), role, password }),
    onSuccess: () => {
      onOpenChange(false);
      onDone();
    },
    onError: (e) => toast({ variant: "error", title: "Could not create user", description: e instanceof Error ? e.message : undefined }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Add user</DialogTitle>
        <DialogDescription>Create a new account with a temporary password.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Full name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" />
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Temporary password</Label>
          <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button
          disabled={mutation.isPending || !email.trim() || !name.trim() || password.length < 8}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
          Create user
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/* ------------------------------- Edit user ------------------------------ */

function EditUserDialog({
  user,
  isSelf,
  onClose,
  onDone,
}: {
  user: AppUser | null;
  isSelf: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<UserRole>("member");
  const [isActive, setIsActive] = React.useState(true);
  const [password, setPassword] = React.useState("");

  React.useEffect(() => {
    if (user) {
      setName(user.name);
      setRole(user.role);
      setIsActive(user.isActive);
      setPassword("");
    }
  }, [user]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("No user");
      const patch: { name?: string; role?: UserRole; isActive?: boolean; password?: string } = {};
      if (name.trim() !== user.name) patch.name = name.trim();
      if (role !== user.role) patch.role = role;
      if (isActive !== user.isActive) patch.isActive = isActive;
      if (password) patch.password = password;
      return updateUser(user.id, patch);
    },
    onSuccess: () => {
      onClose();
      onDone();
    },
    onError: (e) => toast({ variant: "error", title: "Could not update user", description: e instanceof Error ? e.message : undefined }),
  });

  return (
    <Dialog open={!!user} onOpenChange={(v) => !v && onClose()}>
      <DialogHeader>
        <DialogTitle>Edit user</DialogTitle>
        <DialogDescription>{user?.email}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Full name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={isSelf}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
          {isSelf && <p className="text-xs text-muted-foreground">You cannot change your own role.</p>}
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Active</p>
            <p className="text-xs text-muted-foreground">Inactive users cannot sign in.</p>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} disabled={isSelf} />
        </div>
        <div className="space-y-1.5">
          <Label>Reset password</Label>
          <Input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank to keep current password"
          />
          {password.length > 0 && password.length < 8 && (
            <p className="text-xs text-[hsl(var(--invalid))]">Must be at least 8 characters.</p>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          disabled={mutation.isPending || (password.length > 0 && password.length < 8)}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
          Save changes
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/* ------------------------------ Delete user ----------------------------- */

function DeleteUserDialog({
  user,
  onClose,
  onDone,
}: {
  user: AppUser | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("No user");
      return deleteUser(user.id);
    },
    onSuccess: () => {
      onClose();
      onDone();
    },
    onError: (e) => toast({ variant: "error", title: "Could not delete user", description: e instanceof Error ? e.message : undefined }),
  });

  return (
    <Dialog open={!!user} onOpenChange={(v) => !v && onClose()}>
      <DialogHeader>
        <DialogTitle>Delete user</DialogTitle>
        <DialogDescription>
          Permanently remove <span className="font-medium text-foreground">{user?.email}</span>? This cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
          Delete
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

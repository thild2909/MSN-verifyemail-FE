"use client";
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, MoreHorizontal, Loader2, Users, Crown, UserCheck, UserX, Search, ShieldCheck, Pencil, Trash2, Check, UserRound, Mail, KeyRound, Wand2, Eye, EyeOff, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { SettingsCard, Field, Pill, IconTile, TONES, avatarTone, type Tone } from "@/components/settings/settings-ui";
import { getMe, getUsers, createUser, updateUser, deleteUser } from "@/lib/api/client";
import { AvatarPicker } from "@/components/settings/avatar-picker";
import type { AppUser, UserRole } from "@/lib/types";
import { cn, initials } from "@/lib/utils";

const ROLES: { role: UserRole; label: string; tone: Tone; icon: React.ElementType; perms: string[] }[] = [
  {
    role: "admin",
    label: "Admin",
    tone: "brand",
    icon: Crown,
    perms: ["Manage users and roles", "Edit workspace configuration", "Verification, finder, lists and leads"],
  },
  {
    role: "member",
    label: "Member",
    tone: "muted",
    icon: Users,
    perms: ["Verification, finder, lists and leads", "No user management", "No configuration access"],
  },
];

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function UserAvatar({ u, size = "md" }: { u: AppUser; size?: "md" | "lg" }) {
  const label = u.name || u.email;
  if (u.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={u.avatarUrl} alt="" className={cn("shrink-0 rounded-full object-cover ring-1 ring-border", size === "lg" ? "size-10" : "size-9")} />
    );
  }
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full font-semibold", size === "lg" ? "size-10 text-sm" : "size-9 text-xs", TONES[avatarTone(label)])}>
      {initials(label)}
    </span>
  );
}

type Filter = "all" | "admin" | "member" | "inactive";

export default function UsersSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe });
  const { data: users, isLoading } = useQuery({ queryKey: ["users"], queryFn: getUsers });

  const [addOpen, setAddOpen] = React.useState(false);
  const [editUser, setEditUser] = React.useState<AppUser | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<AppUser | null>(null);
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["users"] });

  const all = users ?? [];
  const counts = {
    all: all.length,
    admin: all.filter((u) => u.role === "admin").length,
    member: all.filter((u) => u.role === "member").length,
    inactive: all.filter((u) => !u.isActive).length,
  };
  const s = q.trim().toLowerCase();
  const rows = all.filter((u) => {
    if (filter === "admin" && u.role !== "admin") return false;
    if (filter === "member" && u.role !== "member") return false;
    if (filter === "inactive" && u.isActive) return false;
    return !s || `${u.name} ${u.email}`.toLowerCase().includes(s);
  });

  const actions = (u: AppUser) => {
    const isSelf = u.id === me?.id;
    return (
      <DropdownMenu
        trigger={
          <button className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground" aria-label={`Actions for ${u.email}`}>
            <MoreHorizontal className="size-4" />
          </button>
        }
      >
        <DropdownItem onClick={() => setEditUser(u)}><Pencil /> Edit</DropdownItem>
        <DropdownSeparator />
        <DropdownItem destructive disabled={isSelf} onClick={() => !isSelf && setDeleteTarget(u)}><Trash2 /> Delete</DropdownItem>
      </DropdownMenu>
    );
  };

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: Users, tone: "brand" as Tone, label: "Total users", value: counts.all },
          { icon: Crown, tone: "violet" as Tone, label: "Admins", value: counts.admin },
          { icon: UserCheck, tone: "valid" as Tone, label: "Active", value: counts.all - counts.inactive },
          { icon: UserX, tone: "risky" as Tone, label: "Inactive", value: counts.inactive },
        ].map((c) => (
          <div key={c.label} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 shadow-card">
            <IconTile icon={c.icon} tone={c.tone} />
            <div>
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="text-[15px] font-semibold tabular-nums">{isLoading ? "…" : c.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Users */}
      <SettingsCard
        icon={Users}
        tone="violet"
        title="Team members"
        description="Create accounts and manage roles and access."
        aside={<Button size="sm" onClick={() => setAddOpen(true)}><UserPlus /> Add user</Button>}
        bodyClassName="p-0"
      >
        {/* Toolbar */}
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="inline-flex self-start overflow-x-auto rounded-lg border border-border bg-surface p-0.5 no-scrollbar">
            {(["all", "admin", "member", "inactive"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium capitalize transition-colors",
                  filter === f ? "bg-card text-brand shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f}
                <span className="rounded bg-surface px-1 text-[10px] tabular-nums text-muted-foreground">{counts[f]}</span>
              </button>
            ))}
          </div>
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or email"
              className="pl-9"
              type="search"
              name="team-filter"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <IconTile icon={Users} tone="muted" />
            <p className="text-sm font-medium">{all.length === 0 ? "No users yet" : "No users match"}</p>
            <p className="text-xs text-muted-foreground">{all.length === 0 ? "Add your first teammate to get started." : "Try a different filter or search."}</p>
          </div>
        ) : (
          <>
            {/* Mobile: cards */}
            <ul className="divide-y divide-border md:hidden">
              {rows.map((u) => {
                const isSelf = u.id === me?.id;
                return (
                  <li key={u.id} className="flex items-start gap-3 px-4 py-3">
                    <UserAvatar u={u} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {u.name || "—"}
                        {isSelf && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Pill tone={u.role === "admin" ? "brand" : "muted"}>{u.role}</Pill>
                        <Pill tone={u.isActive ? "valid" : "risky"} dot>{u.isActive ? "active" : "inactive"}</Pill>
                        <span className="text-[11px] text-muted-foreground">· {fmtDate(u.createdAt)}</span>
                      </div>
                    </div>
                    {actions(u)}
                  </li>
                );
              })}
            </ul>

            {/* Desktop: table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-12 pr-5" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((u) => {
                    const isSelf = u.id === me?.id;
                    return (
                      <TableRow key={u.id}>
                        <TableCell className="pl-5">
                          <div className="flex items-center gap-3">
                            <UserAvatar u={u} />
                            <div className="min-w-0">
                              <p className="truncate font-medium">
                                {u.name || "—"}
                                {isSelf && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><Pill tone={u.role === "admin" ? "brand" : "muted"}>{u.role}</Pill></TableCell>
                        <TableCell><Pill tone={u.isActive ? "valid" : "risky"} dot>{u.isActive ? "active" : "inactive"}</Pill></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(u.createdAt)}</TableCell>
                        <TableCell className="pr-5 text-right">{actions(u)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </SettingsCard>

      {/* Roles */}
      <SettingsCard icon={ShieldCheck} tone="valid" title="Roles & permissions" description="What each role can do in this workspace.">
        <div className="grid gap-3 sm:grid-cols-2">
          {ROLES.map((r) => (
            <div key={r.role} className="rounded-lg border border-border p-4">
              <div className="flex items-center gap-2.5">
                <IconTile icon={r.icon} tone={r.tone} size="sm" />
                <p className="text-sm font-semibold">{r.label}</p>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">{counts[r.role]} user{counts[r.role] === 1 ? "" : "s"}</span>
              </div>
              <ul className="mt-3 space-y-1.5">
                {r.perms.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-[hsl(var(--valid))]" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SettingsCard>

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

function DialogIcon({ icon, tone }: { icon: React.ElementType; tone: Tone }) {
  return <IconTile icon={icon} tone={tone} className="mb-3" />;
}

function AddUserDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<UserRole>("member");
  const [password, setPassword] = React.useState("");
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setEmail("");
      setName("");
      setRole("member");
      setPassword("");
      setAvatarUrl(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => createUser({ email: email.trim(), name: name.trim(), role, password, ...(avatarUrl ? { avatarUrl } : {}) }),
    onSuccess: () => {
      onOpenChange(false);
      onDone();
    },
    onError: (e) => toast({ variant: "error", title: "Could not create user", description: e instanceof Error ? e.message : undefined }),
  });

  const [showPw, setShowPw] = React.useState(true);
  const emailBad = email.trim().length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const pwShort = password.length > 0 && password.length < 8;
  const canCreate = !!name.trim() && !!email.trim() && !emailBad && password.length >= 8;
  const pwStrength = Math.min(4, [password.length >= 8, password.length >= 12, /[A-Z]/.test(password) && /[a-z]/.test(password), /\d/.test(password) && /[^A-Za-z0-9]/.test(password)].filter(Boolean).length);

  const generate = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*";
    const buf = new Uint32Array(14);
    crypto.getRandomValues(buf);
    setPassword(Array.from(buf, (n) => chars[n % chars.length]).join(""));
    setShowPw(true);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      toast({ variant: "success", title: "Password copied" });
    } catch {
      toast({ variant: "error", title: "Could not copy" });
    }
  };

  const ROLE_OPTS: { value: UserRole; label: string; desc: string; icon: React.ElementType; tone: Tone }[] = [
    { value: "member", label: "Member", desc: "Verify, find and manage leads", icon: Users, tone: "sky" },
    { value: "admin", label: "Admin", desc: "Everything + users & configuration", icon: Crown, tone: "brand" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="sm:max-w-xl">
      <DialogHeader>
        <div className="mb-3 flex items-center gap-3">
          <IconTile icon={UserPlus} tone="brand" />
          <div>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>Create an account and share a temporary password.</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <form
        className="space-y-5"
        autoComplete="off"
        onSubmit={(e) => { e.preventDefault(); if (canCreate && !mutation.isPending) mutation.mutate(); }}
      >
        {/* Photo */}
        <AvatarPicker value={avatarUrl} onChange={setAvatarUrl} name={name || email} />

        {/* Identity */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="add-name">
            <div className="relative">
              <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="add-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" autoComplete="off" className="pl-9" autoFocus />
            </div>
          </Field>
          <Field label="Work email" htmlFor="add-email" error={emailBad ? "Enter a valid email address." : undefined}>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="add-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@company.com"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                className={cn("pl-9", emailBad && "border-[hsl(var(--invalid))]")}
              />
            </div>
          </Field>
        </div>

        {/* Role */}
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium">Role</p>
          <div role="radiogroup" aria-label="Role" className="grid gap-2 sm:grid-cols-2">
            {ROLE_OPTS.map((o) => {
              const on = role === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setRole(o.value)}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border bg-card p-3 text-left transition-all",
                    on ? "border-brand ring-[3px] ring-brand/15" : "border-border hover:border-brand/40",
                  )}
                >
                  <IconTile icon={o.icon} tone={on ? o.tone : "muted"} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{o.label}</span>
                    <span className="block text-xs text-muted-foreground">{o.desc}</span>
                  </span>
                  <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-brand bg-brand dark:border-primary dark:bg-primary" : "border-input")}>
                    {on && <span className="size-1.5 rounded-full bg-white" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Password */}
        <Field
          label="Temporary password"
          htmlFor="add-pw"
          error={pwShort ? "Must be at least 8 characters." : undefined}
          hint="Share it securely; they can change it after signing in."
          aside={
            <button type="button" onClick={generate} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-brand transition-colors hover:bg-brand/10">
              <Wand2 className="size-3.5" /> Generate
            </button>
          }
        >
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="add-pw"
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              className={cn("pl-9 pr-[4.5rem] font-mono", pwShort && "border-[hsl(var(--invalid))]")}
            />
            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
              <button type="button" onClick={() => setShowPw((v) => !v)} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground" aria-label={showPw ? "Hide password" : "Show password"}>
                {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
              <button type="button" onClick={copy} disabled={!password} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground disabled:opacity-40" aria-label="Copy password">
                <Copy className="size-4" />
              </button>
            </div>
          </div>
          <div className="mt-2 flex gap-1" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors",
                  i < pwStrength ? (pwStrength <= 1 ? "bg-[hsl(var(--invalid))]" : pwStrength === 2 ? "bg-[hsl(var(--risky))]" : "bg-[hsl(var(--valid))]") : "bg-border",
                )}
              />
            ))}
          </div>
        </Field>

        <DialogFooter className="mt-2 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending || !canCreate}>
            {mutation.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />}
            Create user
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/* ------------------------------- Edit user ------------------------------ */

function EditUserDialog({ user, isSelf, onClose, onDone }: { user: AppUser | null; isSelf: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<UserRole>("member");
  const [isActive, setIsActive] = React.useState(true);
  const [password, setPassword] = React.useState("");
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (user) {
      setName(user.name);
      setRole(user.role);
      setIsActive(user.isActive);
      setPassword("");
      setAvatarUrl(user.avatarUrl ?? null);
    }
  }, [user]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("No user");
      const patch: { name?: string; role?: UserRole; isActive?: boolean; password?: string; avatarUrl?: string | null } = {};
      if (name.trim() !== user.name) patch.name = name.trim();
      if (role !== user.role) patch.role = role;
      if (isActive !== user.isActive) patch.isActive = isActive;
      if (password) patch.password = password;
      if ((avatarUrl ?? null) !== (user.avatarUrl ?? null)) patch.avatarUrl = avatarUrl;
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
        <DialogIcon icon={Pencil} tone="violet" />
        <DialogTitle>Edit user</DialogTitle>
        <DialogDescription>{user?.email}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <AvatarPicker value={avatarUrl} onChange={setAvatarUrl} name={name || user?.email || ""} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="edit-name">
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Role" hint={isSelf ? "You cannot change your own role." : undefined}>
            <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={isSelf}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium">Active</p>
            <p className="text-xs text-muted-foreground">Inactive users cannot sign in.</p>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} disabled={isSelf} />
        </div>
        <Field
          label="Reset password"
          htmlFor="edit-pw"
          error={password.length > 0 && password.length < 8 ? "Must be at least 8 characters." : undefined}
        >
          <Input id="edit-pw" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave blank to keep current password" autoComplete="off" />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={mutation.isPending || (password.length > 0 && password.length < 8)} onClick={() => mutation.mutate()}>
          {mutation.isPending && <Loader2 className="animate-spin" />}
          Save changes
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/* ------------------------------ Delete user ----------------------------- */

function DeleteUserDialog({ user, onClose, onDone }: { user: AppUser | null; onClose: () => void; onDone: () => void }) {
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
        <DialogIcon icon={Trash2} tone="invalid" />
        <DialogTitle>Delete user</DialogTitle>
        <DialogDescription>
          Permanently remove <span className="font-medium text-foreground">{user?.email}</span>? This cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending && <Loader2 className="animate-spin" />}
          Delete
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

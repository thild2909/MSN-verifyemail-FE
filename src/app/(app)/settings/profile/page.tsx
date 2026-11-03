"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User, Mail, CalendarDays, ShieldCheck, KeyRound, Building2, Loader2, ChevronRight, Lock, Camera, ImagePlus, Trash2, Upload, Image as ImageIcon, Clock, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { SettingsCard, Field, Pill, IconTile, TONES, avatarTone } from "@/components/settings/settings-ui";
import { getMe, updateMe, getWorkspace, updateWorkspace } from "@/lib/api/client";
import { resizeImageFile, ImageError, ACCEPTED_IMAGE_TYPES, AVATAR_SPEC, BANNER_SPEC, type ResizeOptions } from "@/lib/image-resize";
import { cn, initials } from "@/lib/utils";

function fmtDate(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

/** Relative age, e.g. "2 months ago". */
function ago(iso?: string): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms)) return null;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const s = Math.round(ms / 1000), m = Math.round(s / 60), h = Math.round(m / 60), d = Math.round(h / 24);
  if (s < 60) return "just now";
  if (m < 60) return rtf.format(-m, "minute");
  if (h < 24) return rtf.format(-h, "hour");
  if (d < 30) return rtf.format(-d, "day");
  if (d < 365) return rtf.format(-Math.round(d / 30), "month");
  return rtf.format(-Math.round(d / 365), "year");
}

/** Date cell: weekday-qualified date in tabular figures + a muted relative age. */
function DateValue({ iso }: { iso?: string }) {
  if (!iso) return <span className="text-muted-foreground">—</span>;
  const d = new Date(iso);
  return (
    <time dateTime={iso} title={d.toLocaleString()} className="inline-flex min-w-0 items-center gap-2 text-[13px] font-normal">
      <span className="tabular-nums text-foreground/90">
        {d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
      </span>
      <span className="truncate rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-muted-foreground">{ago(iso)}</span>
    </time>
  );
}

/** Workspace name: editable inline by admins (PATCH /workspace), read-only for members. */
function WorkspaceField({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: ws } = useQuery({ queryKey: ["workspace"], queryFn: getWorkspace, staleTime: 5 * 60_000 });
  const [value, setValue] = React.useState("");
  React.useEffect(() => { if (ws) setValue(ws.name); }, [ws]);
  const dirty = !!ws && value.trim().length > 0 && value.trim() !== ws.name;

  const save = useMutation({
    mutationFn: () => updateWorkspace(value.trim()),
    onSuccess: (next) => {
      qc.setQueryData(["workspace"], next);
      toast({ variant: "success", title: "Workspace renamed", description: next.name });
    },
    onError: (e) => toast({ variant: "error", title: "Could not rename workspace", description: e instanceof Error ? e.message : undefined }),
  });

  return (
    <Field
      label="Workspace"
      htmlFor="workspace"
      hint={isAdmin ? "Shown in the top bar for everyone in this workspace." : "Only admins can rename the workspace."}
      aside={!isAdmin ? <Lock className="size-3 text-muted-foreground" /> : undefined}
    >
      <div className="flex gap-2">
        <Input
          id="workspace"
          value={value}
          maxLength={80}
          disabled={!isAdmin || !ws}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && dirty) save.mutate(); if (e.key === "Escape" && ws) setValue(ws.name); }}
          autoComplete="off"
        />
        {isAdmin && dirty && (
          <Button size="sm" className="h-9 shrink-0" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save
          </Button>
        )}
      </div>
    </Field>
  );
}

/* ------------------------------ image picker ------------------------------ */

/** Hidden file input + drag-and-drop target that resizes and hands back a data URL. */
function useImagePicker(spec: ResizeOptions, onPicked: (dataUrl: string) => void) {
  const { toast } = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);

  const handle = async (file: File | undefined | null) => {
    if (!file) return;
    setProcessing(true);
    try {
      onPicked(await resizeImageFile(file, spec));
    } catch (e) {
      toast({ variant: "error", title: "Couldn't use that image", description: e instanceof ImageError ? e.message : "Please try another file." });
    } finally {
      setProcessing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPTED_IMAGE_TYPES.join(",")}
      className="sr-only"
      tabIndex={-1}
      onChange={(e) => handle(e.target.files?.[0])}
    />
  );
  const dropProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files?.[0]); },
  };
  return { input, open: () => inputRef.current?.click(), processing, dragging, dropProps };
}

/* ---------------------------------- page ---------------------------------- */

export default function ProfileSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me, isLoading } = useQuery({ queryKey: ["me"], queryFn: getMe });
  const [name, setName] = React.useState("");

  React.useEffect(() => {
    if (me) setName(me.name ?? "");
  }, [me]);

  const isAdmin = me?.role === "admin";
  const dirty = !!me && name.trim() !== (me.name ?? "") && name.trim().length > 0;

  // Every profile write goes through PATCH /auth/me (self-service, any role).
  const update = useMutation({
    mutationFn: (patch: { name?: string; avatarUrl?: string | null; bannerUrl?: string | null }) => updateMe(patch),
    onSuccess: (user, patch) => {
      qc.setQueryData(["me"], user);
      qc.invalidateQueries({ queryKey: ["users"] });
      const what = patch.avatarUrl !== undefined ? (patch.avatarUrl ? "Photo updated" : "Photo removed")
        : patch.bannerUrl !== undefined ? (patch.bannerUrl ? "Cover updated" : "Cover removed")
        : "Profile updated";
      toast({ variant: "success", title: what });
    },
    onError: (e) => toast({ variant: "error", title: "Could not update profile", description: e instanceof Error ? e.message : undefined }),
  });
  const pending = (key: "name" | "avatarUrl" | "bannerUrl") => update.isPending && update.variables?.[key] !== undefined;

  const avatarPicker = useImagePicker(AVATAR_SPEC, (avatarUrl) => update.mutate({ avatarUrl }));
  const bannerPicker = useImagePicker(BANNER_SPEC, (bannerUrl) => update.mutate({ bannerUrl }));

  if (isLoading || !me) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const displayName = me.name || me.email;
  const tone = avatarTone(displayName);
  const avatarBusy = avatarPicker.processing || pending("avatarUrl");
  const bannerBusy = bannerPicker.processing || pending("bannerUrl");

  return (
    <div className="space-y-5">
      {/* Hero: cover + avatar */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div
          {...bannerPicker.dropProps}
          className={cn(
            "group relative h-32 overflow-hidden sm:h-44",
            !me.bannerUrl && "bg-gradient-to-r from-brand/20 via-[hsl(280_70%_60%/0.16)] to-[hsl(199_89%_48%/0.16)]",
            bannerPicker.dragging && "ring-2 ring-inset ring-brand",
          )}
        >
          {me.bannerUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={me.bannerUrl} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
          )}
          {/* subtle scrim so the buttons stay legible on any photo */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
          {bannerPicker.dragging && (
            <div className="absolute inset-0 flex items-center justify-center bg-brand/20 text-sm font-semibold text-white backdrop-blur-[1px]">
              Drop to set cover image
            </div>
          )}
          <div className="absolute right-3 top-3 flex gap-1.5">
            <button
              type="button"
              onClick={bannerPicker.open}
              disabled={bannerBusy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/30 bg-black/40 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur-md transition-colors hover:bg-black/55 disabled:opacity-70"
            >
              {bannerBusy ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
              {me.bannerUrl ? "Change cover" : "Add cover"}
            </button>
            {me.bannerUrl && (
              <button
                type="button"
                onClick={() => update.mutate({ bannerUrl: null })}
                disabled={bannerBusy}
                aria-label="Remove cover image"
                title="Remove cover image"
                className="inline-flex items-center justify-center rounded-lg border border-white/30 bg-black/40 px-2 text-white backdrop-blur-md transition-colors hover:bg-[hsl(var(--invalid)/0.8)] disabled:opacity-70"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
          {bannerPicker.input}
        </div>

        <div className="flex flex-col gap-4 px-4 pb-5 sm:flex-row sm:items-end sm:justify-between sm:px-5">
          <div className="flex items-end gap-4">
            {/* Avatar with camera overlay */}
            <div className="relative -mt-12 shrink-0" {...avatarPicker.dropProps}>
              <button
                type="button"
                onClick={avatarPicker.open}
                disabled={avatarBusy}
                aria-label={me.avatarUrl ? "Change profile photo" : "Upload profile photo"}
                className={cn(
                  "group relative flex size-24 items-center justify-center overflow-hidden rounded-full bg-card text-2xl font-semibold ring-4 ring-card",
                  avatarPicker.dragging && "ring-brand",
                )}
              >
                {me.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={me.avatarUrl} alt="" className="size-full object-cover" draggable={false} />
                ) : (
                  <span className={cn("flex size-full items-center justify-center", TONES[tone])}>{initials(displayName)}</span>
                )}
                <span
                  className={cn(
                    "absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/45 text-[11px] font-medium text-white transition-opacity",
                    avatarBusy ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                  )}
                >
                  {avatarBusy ? <Loader2 className="size-5 animate-spin" /> : <><Camera className="size-5" /> {me.avatarUrl ? "Change" : "Upload"}</>}
                </span>
              </button>
              <span className="pointer-events-none absolute bottom-1 right-1 flex size-7 items-center justify-center rounded-full border-2 border-card bg-brand text-white shadow-xs dark:bg-primary">
                <Camera className="size-3.5" />
              </span>
              {avatarPicker.input}
            </div>
            <div className="min-w-0 pb-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-semibold tracking-tight">{displayName}</h2>
                <Pill tone={isAdmin ? "brand" : "muted"}>{me.role}</Pill>
              </div>
              <p className="truncate text-sm text-muted-foreground">{me.email}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill tone={me.isActive ? "valid" : "risky"} dot>{me.isActive ? "Active" : "Inactive"}</Pill>
            <Pill tone="muted"><CalendarDays className="size-3" /> Joined {fmtDate(me.createdAt)}</Pill>
          </div>
        </div>
      </section>

      {/* Photo & cover */}
      <SettingsCard icon={ImageIcon} tone="violet" title="Photo & cover" description="Shown in the top bar and to teammates. Images are cropped and compressed in your browser before upload.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card text-sm font-semibold">
              {me.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={me.avatarUrl} alt="" className="size-full object-cover" />
              ) : (
                <span className={cn("flex size-full items-center justify-center", TONES[tone])}>{initials(displayName)}</span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Profile photo</p>
              <p className="text-xs text-muted-foreground">Square · 256×256 · PNG, JPEG, WebP, GIF</p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" variant="outline" onClick={avatarPicker.open} disabled={avatarBusy}>
                {avatarBusy ? <Loader2 className="animate-spin" /> : <Upload />} {me.avatarUrl ? "Change" : "Upload"}
              </Button>
              {me.avatarUrl && (
                <Button size="sm" variant="ghost" className="hover:bg-destructive/10 hover:text-destructive" onClick={() => update.mutate({ avatarUrl: null })} disabled={avatarBusy} aria-label="Remove photo">
                  <Trash2 />
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <span
              className={cn(
                "flex h-12 w-20 shrink-0 overflow-hidden rounded-md",
                !me.bannerUrl && "bg-gradient-to-r from-brand/25 via-[hsl(280_70%_60%/0.2)] to-[hsl(199_89%_48%/0.2)]",
              )}
            >
              {me.bannerUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={me.bannerUrl} alt="" className="size-full object-cover" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Cover image</p>
              <p className="text-xs text-muted-foreground">Wide · 1500×400 · or drag onto the cover</p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" variant="outline" onClick={bannerPicker.open} disabled={bannerBusy}>
                {bannerBusy ? <Loader2 className="animate-spin" /> : <Upload />} {me.bannerUrl ? "Change" : "Upload"}
              </Button>
              {me.bannerUrl && (
                <Button size="sm" variant="ghost" className="hover:bg-destructive/10 hover:text-destructive" onClick={() => update.mutate({ bannerUrl: null })} disabled={bannerBusy} aria-label="Remove cover">
                  <Trash2 />
                </Button>
              )}
            </div>
          </div>
        </div>
      </SettingsCard>

      {/* Personal information */}
      <SettingsCard
        icon={User}
        title="Personal information"
        description="How you appear to teammates across the workspace."
        footer={
          <>
            {dirty && <Button variant="ghost" onClick={() => setName(me.name ?? "")} disabled={pending("name")}>Discard</Button>}
            <Button onClick={() => update.mutate({ name: name.trim() })} disabled={!dirty || pending("name")}>
              {pending("name") && <Loader2 className="animate-spin" />} Save changes
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Full name"
            htmlFor="name"
          >
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} />
          </Field>
          <Field label="Email" htmlFor="email" hint="Your sign-in address. It can't be changed here." aside={<Lock className="size-3 text-muted-foreground" />}>
            <Input id="email" value={me.email} disabled />
          </Field>
          <Field label="Role" htmlFor="role" hint="Roles are managed by admins in Users.">
            <Input id="role" value={me.role === "admin" ? "Admin" : "Member"} disabled />
          </Field>
          <WorkspaceField isAdmin={isAdmin} />
        </div>
      </SettingsCard>

      {/* Account overview */}
      <SettingsCard icon={Building2} tone="sky" title="Account" description="Details about this sign-in account." bodyClassName="p-0">
        <dl className="divide-y divide-border">
          {[
            { icon: Mail, label: "Email", value: me.email },
            { icon: User, label: "User ID", value: <code className="rounded bg-surface px-1.5 py-0.5 text-xs">{me.id}</code> },
            { icon: CalendarDays, label: "Member since", value: <DateValue iso={me.createdAt} /> },
            { icon: Clock, label: "Last updated", value: <DateValue iso={me.updatedAt} /> },
          ].map((r) => (
            <div key={r.label} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <r.icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <dt className="w-32 shrink-0 text-sm text-muted-foreground">{r.label}</dt>
              <dd className="min-w-0 flex-1 truncate text-sm font-medium">{r.value}</dd>
            </div>
          ))}
        </dl>
      </SettingsCard>

      {/* Security shortcut */}
      <Link
        href="/settings/security"
        className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-card transition-colors hover:border-brand/40 sm:px-5"
      >
        <IconTile icon={ShieldCheck} tone="valid" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Password &amp; security</p>
          <p className="text-xs text-muted-foreground">Change your password, two-factor and signed-in devices.</p>
        </div>
        <KeyRound className="hidden size-4 text-muted-foreground sm:block" />
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

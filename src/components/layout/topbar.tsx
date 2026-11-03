"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, ChevronDown, Check, Settings, User, Users, CreditCard, LogOut, Sun, Moon, Command } from "lucide-react";
import { NotificationBell } from "./notification-bell";
import { CommandPalette, Kbd } from "./command-palette";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { ThemeToggle, useTheme } from "@/components/theme/theme-provider";
import { BrandMark } from "@/components/brand/brand-logo";
import { getMe, getWorkspace, logout } from "@/lib/api/client";
import { cn, initials } from "@/lib/utils";


/* Token-driven soft avatar colours, stable per name, legible in both themes. */
const AVATAR_TONES = [
  "bg-brand/15 text-brand",
  "bg-[hsl(var(--valid)/0.15)] text-[hsl(var(--valid))]",
  "bg-[hsl(var(--risky)/0.16)] text-[hsl(var(--risky))]",
  "bg-[hsl(280_70%_60%/0.15)] text-[hsl(280_65%_55%)] dark:text-[hsl(280_80%_75%)]",
  "bg-[hsl(199_89%_48%/0.15)] text-[hsl(199_89%_40%)] dark:text-[hsl(199_90%_65%)]",
];

function Avatar({ name, size = "md", src }: { name: string; size?: "md" | "lg"; src?: string | null }) {
  const tone = AVATAR_TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className={cn("shrink-0 rounded-full object-cover ring-1 ring-border", size === "lg" ? "size-11" : "size-8")}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        size === "lg" ? "size-11 text-sm" : "size-8 text-xs",
        tone,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Menu row with an icon, a label and an optional one-line description. */
function MenuRow({
  icon: Icon, label, description, trailing, onClick, destructive,
}: {
  icon: React.ElementType; label: string; description?: string; trailing?: React.ReactNode; onClick: () => void; destructive?: boolean;
}) {
  return (
    <DropdownItem onClick={onClick} destructive={destructive} className="items-start py-2">
      <Icon className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {description && <span className="block truncate text-xs text-muted-foreground">{description}</span>}
      </span>
      {trailing}
    </DropdownItem>
  );
}

export function Topbar() {
  const router = useRouter();
  const qc = useQueryClient();
  const { resolved, setTheme } = useTheme();
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [isMac, setIsMac] = React.useState(false);

  const { data: user } = useQuery({ queryKey: ["me"], queryFn: getMe });
  const { data: ws } = useQuery({ queryKey: ["workspace"], queryFn: getWorkspace, staleTime: 5 * 60_000 });
  const WORKSPACE = ws?.name || "MSN Workspace";
  const wsMark = (WORKSPACE.trim()[0] ?? "M").toUpperCase();
  const displayName = user?.name || user?.email || "Account";

  // Global ⌘K / Ctrl+K toggles the command palette.
  React.useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const signOut = async () => {
    await logout();
    qc.clear();
    window.location.href = "/login";
  };

  // 40px targets on phones, 36px on desktop.
  const iconBtn =
    "flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface hover:text-foreground sm:size-9";

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/85 pt-safe backdrop-blur-xl">
      <div className="flex h-14 min-w-0 items-center gap-1.5 px-3 sm:gap-2 sm:px-5">
        {/* Phone: brand mark (the sidebar carries the brand on desktop) */}
        <Link href="/verification" className="shrink-0 lg:hidden" aria-label="Home">
          <BrandMark size="sm" />
        </Link>

        {/* Workspace switcher */}
        <DropdownMenu
          align="start"
          className="w-60"
          trigger={
            <button
              type="button"
              className="flex h-10 min-w-0 max-w-[46vw] items-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors hover:bg-surface sm:h-9 sm:max-w-[40vw] sm:border sm:border-border sm:px-2.5"
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-foreground text-[10px] font-bold text-background">{wsMark}</span>
              <span className="truncate">{WORKSPACE}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          }
        >
          <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">Workspaces</p>
          <DropdownItem className="items-start py-2">
            <Check className="mt-0.5 !text-brand" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{WORKSPACE}</span>
              <span className="block truncate text-xs capitalize text-muted-foreground">{user?.role ?? "member"}</span>
            </span>
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem onClick={() => router.push("/settings")}><Settings /> Workspace settings</DropdownItem>
        </DropdownMenu>

        {/* Command / search — a button, not an input, so autofill can never land here */}
        <div className="ml-1 hidden flex-1 md:block">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-muted-foreground transition-colors hover:border-input hover:bg-muted"
          >
            <Search className="size-4" />
            <span className="flex-1 truncate text-left">Search lists, leads, tools</span>
            <Kbd className="hidden lg:inline-flex">
              {isMac ? <Command className="size-2.5" /> : "Ctrl"}K
            </Kbd>
          </button>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
          {/* Phone: search trigger (the full bar is hidden below md) */}
          <button type="button" onClick={() => setSearchOpen(true)} className={cn(iconBtn, "md:hidden")} aria-label="Search">
            <Search className="size-[18px]" />
          </button>
          <ThemeToggle className="mr-1 hidden sm:inline-flex" />
          <NotificationBell buttonClassName={iconBtn} />

          <DropdownMenu
            className="w-72"
            trigger={
              <button type="button" className="flex h-10 items-center gap-1.5 rounded-lg p-1 transition-colors hover:bg-surface sm:h-auto" aria-label="Account menu">
                <Avatar name={displayName} src={user?.avatarUrl} />
                <ChevronDown className="hidden size-3.5 text-muted-foreground sm:block" />
              </button>
            }
          >
            {/* Who is signed in, and where. */}
            <div className="mb-1 flex items-center gap-3 rounded-lg bg-surface/70 px-2.5 py-2.5">
              <Avatar name={displayName} size="lg" src={user?.avatarUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight">{user?.name || "Account"}</p>
                {user?.email && <p className="mt-0.5 truncate text-xs text-muted-foreground">{user.email}</p>}
                <p className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="flex size-3.5 shrink-0 items-center justify-center rounded bg-foreground text-[8px] font-bold text-background">{wsMark}</span>
                  <span className="truncate">{WORKSPACE}</span>
                  {user?.role && (
                    <span className="shrink-0 rounded-full bg-brand/10 px-1.5 text-[10px] font-medium capitalize text-brand">{user.role}</span>
                  )}
                </p>
              </div>
            </div>

            <MenuRow icon={User} label="Profile" description="Your name and account details" onClick={() => router.push("/settings/profile")} />
            <MenuRow icon={Settings} label="Settings" description="Workspace configuration" onClick={() => router.push("/settings")} />
            {user?.role === "admin" && (
              <MenuRow icon={Users} label="Users" description="Invite and manage teammates" onClick={() => router.push("/settings/team")} />
            )}
            <MenuRow icon={CreditCard} label="Billing & credits" description="Balance, top-ups and history" onClick={() => router.push("/billing")} />

            <DropdownSeparator />
            <MenuRow
              icon={resolved === "dark" ? Moon : Sun}
              label="Theme"
              trailing={
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">{resolved === "dark" ? "Dark" : "Light"}</span>
              }
              onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
            />

            <DropdownSeparator />
            <MenuRow icon={LogOut} label="Sign out" destructive onClick={signOut} />
          </DropdownMenu>
        </div>
      </div>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}

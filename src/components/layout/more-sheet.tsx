"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ExternalLink, LogOut, Search, ShieldCheck, X } from "lucide-react";
import { ThemeToggle } from "@/components/theme/theme-provider";
import { getMe, getWorkspace, logout } from "@/lib/api/client";
import { NAV, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Avatar, MSN_APPS } from "./topbar";

/** Pages that live in the sheet only, each filling out its section's 3-tile row. */
const EXTRAS: Record<string, NavItem[]> = {
  Developer: [{ label: "API docs", href: "/api/docs", icon: BookOpen }],
  Workspace: [{ label: "Security", href: "/settings/security", icon: ShieldCheck }],
};

const DISMISS_MS = 180;
/** Drag distance (px) or flick speed (px/ms) that dismisses the sheet. */
const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 0.4;
const VELOCITY_WINDOW_MS = 100;

const recentSamples = (samples: { y: number; t: number }[], now: number) =>
  samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);

/**
 * The "More" surface on phones: a bottom sheet of everything that isn't already
 * on the tab bar (`tabHrefs`). Only mounted while open.
 */
export function MoreSheet({
  tabHrefs,
  onClose,
  onSearch,
}: {
  tabHrefs: string[];
  onClose: () => void;
  onSearch: () => void;
}) {
  const pathname = usePathname();
  const qc = useQueryClient();
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: getMe });
  const { data: ws } = useQuery({ queryKey: ["workspace"], queryFn: getWorkspace, staleTime: 5 * 60_000 });
  const displayName = user?.name || user?.email || "Account";

  const sections = React.useMemo(
    () =>
      NAV.map((s) => ({
        title: s.title,
        items: [...s.items.filter((i) => !tabHrefs.includes(i.href)), ...(EXTRAS[s.title ?? ""] ?? [])],
      })).filter((s) => s.items.length > 0),
    [tabHrefs],
  );

  // Most specific match wins, so /api/docs lights up "API docs" and not "API" too.
  const activeHref = React.useMemo(() => {
    const matches = sections
      .flatMap((s) => s.items)
      .filter((i) => (i.match ?? [i.href]).some((p) => pathname === p || pathname.startsWith(p + "/")));
    return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href;
  }, [sections, pathname]);

  const sheetRef = React.useRef<HTMLDivElement>(null);
  const backdropRef = React.useRef<HTMLDivElement>(null);
  const dismissTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // `samples` holds the last VELOCITY_WINDOW_MS of the drag, so a flick is judged on how it ends.
  const drag = React.useRef<{ y: number; dy: number; samples: { y: number; t: number }[] } | null>(null);
  const [signingOut, setSigningOut] = React.useState(false);

  // Move focus into the dialog, and hand it back to the opener on close.
  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus({ preventScroll: true });
    return () => {
      clearTimeout(dismissTimer.current);
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  const dismiss = () => {
    const sheet = sheetRef.current;
    if (!sheet || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onClose();
    sheet.style.transition = `transform ${DISMISS_MS}ms ease-in`;
    sheet.style.transform = "translateY(100%)";
    if (backdropRef.current) {
      backdropRef.current.style.transition = `opacity ${DISMISS_MS}ms ease-in`;
      backdropRef.current.style.opacity = "0";
    }
    dismissTimer.current = setTimeout(onClose, DISMISS_MS);
  };

  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("button, a")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, dy: 0, samples: [{ y: e.clientY, t: e.timeStamp }] };
    if (sheetRef.current) sheetRef.current.style.transition = "none";
  };
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !sheetRef.current) return;
    d.dy = Math.max(0, e.clientY - d.y);
    d.samples = recentSamples(d.samples, e.timeStamp);
    d.samples.push({ y: e.clientY, t: e.timeStamp });
    sheetRef.current.style.transform = `translateY(${d.dy}px)`;
  };
  const onDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !sheetRef.current) return;
    // No recent samples means the finger held still before lifting: not a flick.
    const recent = recentSamples(d.samples, e.timeStamp);
    const velocity =
      recent.length > 1 ? (recent[recent.length - 1].y - recent[0].y) / Math.max(1, e.timeStamp - recent[0].t) : 0;
    if (e.type === "pointerup" && (d.dy > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY)) return dismiss();
    sheetRef.current.style.transition = "transform 200ms ease-out";
    sheetRef.current.style.transform = "";
  };

  // Keep Tab inside the dialog while it's open.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !sheetRef.current) return;
    const focusable = sheetRef.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)");
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current = document.activeElement;
    if (e.shiftKey && (current === first || current === sheetRef.current)) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && current === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    await logout();
    qc.clear();
    window.location.href = "/login";
  };

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        ref={backdropRef}
        className="absolute inset-0 touch-none animate-fade-in bg-black/40 backdrop-blur-[2px]"
        onClick={dismiss}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="More"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[90dvh] max-w-lg animate-sheet-up flex-col rounded-t-2xl bg-card shadow-pop outline-none pl-safe pr-safe motion-reduce:animate-none"
      >
        {/* Drag zone: the handle and the empty parts of the header. */}
        <div
          className="shrink-0 cursor-grab touch-none select-none"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div className="flex justify-center pb-2 pt-2.5" aria-hidden>
            <span className="h-1 w-9 rounded-full bg-border" />
          </div>
          <div className="flex items-center gap-2 px-3 pb-3">
            <Avatar name={displayName} src={user?.avatarUrl} />
            <div className="min-w-0 flex-1 pl-0.5">
              <p className="truncate text-sm font-semibold leading-tight">{user?.name || "Account"}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{ws?.name || "MSN Workspace"}</p>
            </div>
            <ThemeToggle size="md" className="shrink-0" />
            <button
              type="button"
              onClick={dismiss}
              aria-label="Close menu"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors active:bg-surface"
            >
              <X className="size-5" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div className="shrink-0 border-b border-border px-3 pb-3">
          {/* A button, not an input: opens the shared palette without popping the keyboard here. */}
          <button
            type="button"
            onClick={onSearch}
            className="flex h-11 w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-3 text-sm text-muted-foreground transition-colors active:bg-muted"
          >
            <Search className="size-4 shrink-0" />
            <span className="truncate">Search pages and actions…</span>
          </button>
        </div>

        <nav aria-label="More pages" className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-3">
          {sections.map((s) => (
            <section key={s.title}>
              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{s.title}</h3>
              <ul className="grid grid-cols-3 gap-2">
                {s.items.map((item) => (
                  <li key={item.href}>
                    <Tile item={item} active={item.href === activeHref} onNavigate={onClose} />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section>
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Mind Supernova apps</h3>
            <ul className="flex flex-wrap gap-2">
              {MSN_APPS.map((app) => (
                <li key={app.href}>
                  <a
                    href={app.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-11 items-center gap-1.5 rounded-full border border-border px-3.5 text-[13px] font-medium text-foreground/85 transition-colors active:bg-surface"
                  >
                    <app.icon className="size-4 text-muted-foreground" strokeWidth={1.75} />
                    {app.label}
                    <ExternalLink className="size-3 text-muted-foreground" strokeWidth={1.75} aria-label="Opens in a new tab" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </nav>

        <div
          className="shrink-0 border-t border-border px-3 pt-1.5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.375rem)" }}
        >
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-destructive transition-colors active:bg-destructive/10 disabled:opacity-60"
          >
            <LogOut className="size-4" strokeWidth={1.75} />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tile({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      // Tapping the current page changes no route, so close explicitly.
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-xl border px-1.5 py-2 text-center text-[13px] font-medium leading-tight transition-[background-color,transform] active:scale-[0.97] motion-reduce:active:scale-100",
        active ? "border-brand/40 bg-brand/10 text-brand" : "border-border bg-surface/50 text-foreground/85 active:bg-surface",
      )}
    >
      <Icon className={cn("size-5 shrink-0", !active && "text-muted-foreground")} strokeWidth={1.75} />
      <span>{item.label}</span>
      {item.soon && (
        <span className="absolute right-1 top-1 rounded-full bg-muted px-1 text-[9px] font-medium leading-4 text-muted-foreground">
          Soon
        </span>
      )}
    </Link>
  );
}

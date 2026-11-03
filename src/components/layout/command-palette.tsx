"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { Search, ChevronRight, CornerDownLeft, ArrowUp, ArrowDown, Sun, Moon, Monitor, LogOut, type LucideIcon } from "lucide-react";
import { NAV } from "@/lib/nav";
import { useTheme } from "@/components/theme/theme-provider";
import { logout } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface Cmd {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  /** The page you're on right now (gets a "Current" tag). */
  current?: boolean;
  run: () => void;
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded border border-border bg-card px-1 font-sans text-[10px] font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** ⌘K palette: jump to any page, switch theme, sign out. */
/* Extra search words per page, so e.g. "credits" finds Billing and "keys" finds API. */
const KEYWORDS: Record<string, string> = {
  "/verification": "verify bulk upload csv check validate",
  "/finder": "find person email lookup",
  "/find-leads": "people companies jobs linkedin prospects ai crawl",
  "/lists": "saved leads collection",
  "/inbox-placement": "seed spam deliverability",
  "/blacklist": "reputation spamhaus ip block",
  "/analytics": "stats reports charts volume",
  "/api": "keys webhooks docs developer token",
  "/integrations": "connect zapier crm",
  "/settings": "profile security password team users config",
  "/billing": "credits plan invoice top up payment",
};
/** Shown (in this order) when the box is empty. */
const QUICK_LINKS = ["/verification", "/finder", "/find-leads", "/lists", "/analytics"];
const RECENT_KEY = "palette-recent";
const MAX_RECENT = 3;
const MAX_PAGE_RESULTS = 8;

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function pushRecent(href: string) {
  try {
    const next = [href, ...readRecent().filter((h) => h !== href)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

/** Relevance of `text` for query `s`: whole-label prefix > word prefix > substring. */
function score(s: string, label: string, extra: string): number {
  const l = label.toLowerCase();
  if (l === s) return 100;
  if (l.startsWith(s)) return 80;
  if (l.split(/[\s&/]+/).some((w) => w.startsWith(s))) return 60;
  if (l.includes(s)) return 40;
  const e = extra.toLowerCase();
  if (e.split(/\s+/).some((w) => w.startsWith(s))) return 25;
  if (e.includes(s)) return 10;
  return 0;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { setTheme, resolved } = useTheme();
  const [q, setQ] = React.useState("");
  const [idx, setIdx] = React.useState(0);
  const [mounted, setMounted] = React.useState(false);
  const [recent, setRecent] = React.useState<string[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => setMounted(true), []);

  const isCurrent = React.useCallback(
    (href: string, match?: string[]) => (match ?? [href]).some((p) => pathname === p || pathname.startsWith(p + "/")),
    [pathname],
  );

  /** Every page, in sidebar order, with its section as the hint. */
  const pages = React.useMemo(
    () =>
      NAV.flatMap((s) =>
        s.items.map((it) => ({
          href: it.href,
          cmd: {
            id: `page:${it.href}`,
            group: "Pages",
            label: it.label,
            hint: s.title,
            icon: it.icon,
            current: isCurrent(it.href, it.match),
            run: () => {
              pushRecent(it.href);
              router.push(it.href);
            },
          } as Cmd,
        })),
      ),
    [router, isCurrent],
  );

  const actions = React.useMemo(() => {
    const signOut: Cmd = {
      id: "signout",
      group: "Actions",
      label: "Sign out",
      icon: LogOut,
      run: async () => {
        await logout();
        window.location.href = "/login";
      },
    };
    const themes: Cmd[] = [
      { id: "theme:light", group: "Actions", label: "Switch to light theme", icon: Sun, run: () => setTheme("light") },
      { id: "theme:dark", group: "Actions", label: "Switch to dark theme", icon: Moon, run: () => setTheme("dark") },
      { id: "theme:system", group: "Actions", label: "Use system theme", icon: Monitor, run: () => setTheme("system") },
    ];
    // Default view only offers the theme you're NOT on.
    const toggle = resolved === "dark" ? themes[0] : themes[1];
    return { signOut, themes, toggle };
  }, [setTheme, resolved]);

  const results = React.useMemo<Cmd[]>(() => {
    const s = q.trim().toLowerCase();
    if (!s) {
      const recentCmds = recent
        .map((h) => pages.find((p) => p.href === h)?.cmd)
        .filter((c): c is Cmd => !!c)
        .map((c) => ({ ...c, group: "Recent" }));
      const shown = new Set(recentCmds.map((c) => c.id));
      const quick = QUICK_LINKS.map((h) => pages.find((p) => p.href === h)?.cmd)
        .filter((c): c is Cmd => !!c && !shown.has(c.id))
        .map((c) => ({ ...c, group: "Quick links" }));
      return [...recentCmds, ...quick, { ...actions.toggle }, actions.signOut];
    }

    const pageHits = pages
      .map((p, order) => ({ cmd: p.cmd, s: score(s, p.cmd.label, `${p.cmd.hint ?? ""} ${KEYWORDS[p.href] ?? ""}`), order }))
      .filter((h) => h.s > 0)
      .sort((a, b) => b.s - a.s || a.order - b.order)
      .slice(0, MAX_PAGE_RESULTS)
      .map((h) => h.cmd);

    const themeWords = "theme dark light system mode appearance";
    const actionHits = [...actions.themes, actions.signOut].filter(
      (c) => score(s, c.label, c.id.startsWith("theme") ? themeWords : "logout log out exit") > 0,
    );
    return [...pageHits, ...actionHits];
  }, [q, pages, actions, recent]);

  // Reset on open; lock page scroll while open.
  React.useEffect(() => {
    if (!open) return;
    setQ("");
    setIdx(0);
    setRecent(readRecent());
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.body.style.overflow = "";
    };
  }, [open]);

  React.useEffect(() => setIdx(0), [q]);

  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const run = (c: Cmd | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  if (!mounted || !open) return null;

  // Group while keeping a flat index for keyboard navigation.
  const groups: { name: string; items: { cmd: Cmd; i: number }[] }[] = [];
  results.forEach((cmd, i) => {
    let g = groups.find((x) => x.name === cmd.group);
    if (!g) groups.push((g = { name: cmd.group, items: [] }));
    g.items.push({ cmd, i });
  });

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center sm:p-8 sm:pt-[12vh]">
      <div className="absolute inset-0 animate-fade-in bg-[hsl(var(--shadow-color)/0.45)] backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative z-10 flex h-[100dvh] w-full animate-fade-in flex-col overflow-hidden bg-popover shadow-pop sm:h-auto sm:max-w-xl sm:rounded-2xl sm:border sm:border-border"
      >
        <div className="flex items-center gap-2.5 border-b border-border pl-4 pr-2 pt-safe sm:pr-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); run(results[idx]); }
              else if (e.key === "Escape") { e.preventDefault(); onClose(); }
            }}
            placeholder="Search pages and actions…"
            aria-label="Search pages and actions"
            // Not a login field: keep password managers / autofill out of it.
            type="text"
            name="msn-command-search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            className="h-14 min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none sm:h-12"
          />
          <Kbd className="hidden sm:inline-flex">Esc</Kbd>
          <button onClick={onClose} className="h-9 shrink-0 rounded-md px-2.5 text-sm font-medium text-brand hover:bg-brand/10 sm:hidden">
            Cancel
          </button>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain p-2 scrollbar-thin sm:max-h-[60vh] sm:flex-none">
          {results.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">No results for “{q}”</div>
          ) : (
            groups.map((g) => (
              <div key={g.name} className="mb-1.5 last:mb-0">
                <div className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground">{g.name}</div>
                {g.items.map(({ cmd, i }) => {
                  const Icon = cmd.icon;
                  const active = i === idx;
                  return (
                    <button
                      key={cmd.id}
                      data-idx={i}
                      type="button"
                      onMouseMove={() => setIdx(i)}
                      onClick={() => run(cmd)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                        active ? "bg-accent" : "hover:bg-surface",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card",
                          active ? "text-brand" : "text-muted-foreground",
                        )}
                      >
                        <Icon className="size-4" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm", active ? "text-accent-foreground" : "text-foreground")}>{cmd.label}</span>
                        {cmd.hint && <span className="block truncate text-xs text-muted-foreground">{cmd.hint}</span>}
                      </span>
                      {cmd.current && (
                        <span className="shrink-0 rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">Current</span>
                      )}
                      {active ? (
                        <CornerDownLeft className="hidden size-3.5 text-muted-foreground sm:block" />
                      ) : (
                        <ChevronRight className="hidden size-3.5 text-muted-foreground sm:block" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="hidden items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground sm:flex">
          <span className="flex items-center gap-1"><Kbd><ArrowUp className="size-2.5" /></Kbd><Kbd><ArrowDown className="size-2.5" /></Kbd> navigate</span>
          <span className="flex items-center gap-1"><Kbd><CornerDownLeft className="size-2.5" /></Kbd> open</span>
          <span className="flex items-center gap-1"><Kbd>Esc</Kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

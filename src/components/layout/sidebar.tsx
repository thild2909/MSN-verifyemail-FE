"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV } from "@/lib/nav";
import { BrandLockup } from "@/components/brand/brand-logo";
import { cn } from "@/lib/utils";

// v2: the rail now starts collapsed, so older saved choices do not carry over.
const COLLAPSE_KEY = "sidebar-collapsed-v2";

function isActive(pathname: string, href: string, match?: string[]) {
  const prefixes = match ?? [href];
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function SidebarContent({
  collapsed = false,
  pinnedCollapsed = false,
  onToggleCollapse,
}: {
  /** Render the narrow icon-only rail. */
  collapsed?: boolean;
  /** The user's pinned choice (drives the Expand / Collapse button). */
  pinnedCollapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className={cn("flex h-16 shrink-0 items-center", collapsed ? "justify-center px-2" : "px-5")}>
        <Link href="/verification" className="min-w-0" aria-label="Mind Supernova home">
          <BrandLockup compact={collapsed} size="sm" />
        </Link>
      </div>

      {/* Nav */}
      <nav className={cn("scrollbar-thin flex-1 space-y-5 overflow-y-auto pb-4 pt-2", collapsed ? "px-2" : "px-3")}>
        {NAV.map((section, i) => (
          <div key={i}>
            {section.title &&
              (collapsed ? (
                i > 0 && <div className="mx-2 mb-3 h-px bg-sidebar-border" aria-hidden />
              ) : (
                <p className="mb-1.5 px-3 text-xs font-medium text-sidebar-muted">{section.title}</p>
              ))}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href, item.match);
                const Icon = item.icon;
                return (
                  <li key={item.href} className="relative">
                    {active && !collapsed && (
                      <span
                        className="absolute -left-3 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-accent"
                        aria-hidden
                      />
                    )}
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex items-center gap-3 rounded-lg text-sm transition-colors",
                        collapsed ? "mx-auto size-10 justify-center" : "px-3 py-2",
                        active
                          ? "bg-sidebar-active font-semibold text-sidebar-accent"
                          : "font-medium text-sidebar-foreground/85 hover:bg-surface hover:text-sidebar-foreground",
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-[18px] shrink-0",
                          active ? "text-sidebar-accent" : "text-sidebar-muted group-hover:text-sidebar-foreground",
                        )}
                        strokeWidth={1.75}
                      />
                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                      {!collapsed && item.soon && (
                        <span className="rounded-full border border-sidebar-border px-2 py-0.5 text-[10px] font-medium text-sidebar-muted">
                          Soon
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Collapse */}
      {onToggleCollapse && (
        <div className={cn("shrink-0 border-t border-sidebar-border py-2", collapsed ? "px-2" : "px-3")}>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
            title={pinnedCollapsed ? "Keep sidebar open" : "Collapse sidebar"}
            aria-label={pinnedCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg text-sm font-medium text-sidebar-foreground/85 transition-colors hover:bg-surface hover:text-sidebar-foreground",
              collapsed ? "mx-auto size-10 justify-center" : "px-3 py-2",
            )}
          >
            {pinnedCollapsed ? (
              <PanelLeftOpen className="size-[18px] text-sidebar-muted" strokeWidth={1.75} />
            ) : (
              <PanelLeftClose className="size-[18px] text-sidebar-muted" strokeWidth={1.75} />
            )}
            {!collapsed && <span>{pinnedCollapsed ? "Expand" : "Collapse"}</span>}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Desktop rail (lg+). Collapsed by default; hovering it (after a short delay),
 * focusing into it, or clicking its empty area opens it. The Collapse / Expand
 * button pins the choice (remembered per browser).
 */
export function Sidebar() {
  // Pinned state: true = rail stays collapsed unless peeked open.
  const [collapsed, setCollapsed] = React.useState(true);
  const [peek, setPeek] = React.useState(false);
  const peekTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => {
    try {
      // Anything but an explicit "0" (pinned open) starts collapsed.
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) !== "0");
    } catch {}
    return () => clearTimeout(peekTimer.current);
  }, []);

  const toggle = () => {
    clearTimeout(peekTimer.current);
    setPeek(false);
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  // Short delay so sweeping the cursor past the left edge doesn't flash it open.
  const openPeek = () => {
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(true), 120);
  };
  const closePeek = () => {
    clearTimeout(peekTimer.current);
    setPeek(false);
  };

  const expanded = !collapsed || peek;
  const width = expanded ? "w-64" : "w-[72px]";
  return (
    // The aside reserves the rail's current width, so the page shifts over
    // instead of being covered while the rail is hover-expanded.
    <aside
      className={cn("hidden shrink-0 transition-[width] duration-200 lg:block", width)}
      onMouseEnter={collapsed ? openPeek : undefined}
      onMouseLeave={collapsed ? closePeek : undefined}
      onFocus={collapsed ? () => setPeek(true) : undefined}
      onBlur={(e) => {
        if (collapsed && !e.currentTarget.contains(e.relatedTarget as Node | null)) closePeek();
      }}
      onClick={collapsed && !peek ? () => { clearTimeout(peekTimer.current); setPeek(true); } : undefined}
    >
      <div className={cn("fixed inset-y-0 left-0 z-30 transition-[width] duration-200", width, peek && "shadow-pop")}>
        <SidebarContent collapsed={!expanded} pinnedCollapsed={collapsed} onToggleCollapse={toggle} />
      </div>
    </aside>
  );
}

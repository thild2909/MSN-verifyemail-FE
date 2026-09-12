"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { MailCheck, Search, Radar, ListChecks, Menu, X } from "lucide-react";
import { SidebarContent } from "./sidebar";
import { cn } from "@/lib/utils";

/* --------------------------- shared drawer state -------------------------- */

interface MobileNavCtx {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}
const Ctx = React.createContext<MobileNavCtx | null>(null);

export function useMobileNav(): MobileNavCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useMobileNav must be used within MobileNavProvider");
  return ctx;
}

/**
 * Owns the slide-in full-navigation drawer (the "More" surface) shared by the
 * top-bar hamburger and the bottom tab bar. Renders nothing on desktop.
 */
export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const pathname = usePathname();
  React.useEffect(() => setMounted(true), []);
  // Close the drawer whenever the route changes.
  React.useEffect(() => setIsOpen(false), [pathname]);
  React.useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setIsOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  const value = React.useMemo(
    () => ({ open: () => setIsOpen(true), close: () => setIsOpen(false), isOpen }),
    [isOpen],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {mounted &&
        isOpen &&
        createPortal(
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={() => setIsOpen(false)} />
            <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs animate-slide-in-left">
              <div className="min-w-0 flex-1 overflow-hidden shadow-2xl">
                <SidebarContent onNavigate={() => setIsOpen(false)} />
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="absolute right-3 top-3 rounded-lg bg-white/10 p-2 text-white backdrop-blur transition-colors hover:bg-white/20"
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  );
}

/* ------------------------------ bottom tab bar ---------------------------- */

function isActive(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

const TABS = [
  { label: "Verify", href: "/verification", icon: MailCheck, match: ["/verification", "/dashboard"] },
  { label: "Finder", href: "/finder", icon: Search, match: ["/finder"] },
  { label: "Leads", href: "/find-leads", icon: Radar, match: ["/find-leads"] },
  { label: "Lists", href: "/lists", icon: ListChecks, match: ["/lists"] },
];

/**
 * Thumb-reachable primary navigation, mobile only. Four core destinations plus
 * a "More" button that reveals the full nav drawer. Sits above the home
 * indicator via safe-area padding; hidden from `lg` up where the sidebar shows.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const { open, isOpen } = useMobileNav();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-safe backdrop-blur lg:hidden"
      aria-label="Primary"
    >
      <div className="mx-auto flex h-14 max-w-lg items-stretch">
        {TABS.map((t) => {
          const active = isActive(pathname, t.match);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className={cn("size-[22px]", active && "stroke-[2.25]")} />
              <span>{t.label}</span>
            </Link>
          );
        })}
        <button
          onClick={open}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
            isOpen ? "text-primary" : "text-muted-foreground",
          )}
          aria-label="More"
        >
          <Menu className="size-[22px]" />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}

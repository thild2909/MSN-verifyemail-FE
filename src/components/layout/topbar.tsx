"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Moon, Sun, MailCheck } from "lucide-react";
import { NotificationBell } from "./notification-bell";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { getMe, logout } from "@/lib/api/client";
import { initials } from "@/lib/utils";

function useDarkMode() {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => {
    const saved = localStorage.getItem("theme") === "dark";
    setDark(saved);
    document.documentElement.classList.toggle("dark", saved);
  }, []);
  const toggle = () => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  };
  return { dark, toggle };
}

export function Topbar() {
  const { dark, toggle } = useDarkMode();

  const { data: user } = useQuery({ queryKey: ["me"], queryFn: getMe });
  const displayName = user?.name || "Account";
  const displayEmail = user?.email ?? "";

  const signOut = async () => {
    await logout();
    window.location.href = "/login";
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/80 px-3 pt-safe backdrop-blur sm:px-4 lg:h-16 lg:px-6">
      {/* Mobile brand (the sidebar — which carries the brand on desktop — is hidden here) */}
      <div className="flex items-center gap-2 lg:hidden">
        <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar">
          <MailCheck className="size-[18px] text-white" />
        </div>
        <span className="text-base font-bold tracking-tight">Verifly</span>
      </div>

      {/* Search (from sm up — dropped on the smallest screens to save space) */}
      <div className="relative hidden max-w-md flex-1 sm:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder="Search lists, emails, domains…"
          className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
        <button onClick={toggle} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Toggle theme">
          {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>
        <NotificationBell />

        <DropdownMenu
          trigger={
            <button className="ml-0.5 flex items-center gap-2 rounded-lg py-1 pl-1 pr-1 hover:bg-muted sm:pr-2" aria-label="Account menu">
              <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {initials(displayName)}
              </span>
              <span className="hidden text-sm font-medium sm:block">{displayName}</span>
            </button>
          }
        >
          <div className="px-2.5 py-2">
            <p className="text-sm font-medium">{displayName}</p>
            {displayEmail && <p className="text-xs text-muted-foreground">{displayEmail}</p>}
          </div>
          <DropdownSeparator />
          <DropdownItem onClick={() => (window.location.href = "/settings/profile")}>Profile</DropdownItem>
          {user?.role === "admin" && (
            <DropdownItem onClick={() => (window.location.href = "/settings/team")}>Users</DropdownItem>
          )}
          <DropdownItem onClick={() => (window.location.href = "/billing")}>Billing</DropdownItem>
          <DropdownSeparator />
          <DropdownItem destructive onClick={signOut}>
            Sign out
          </DropdownItem>
        </DropdownMenu>
      </div>
    </header>
  );
}

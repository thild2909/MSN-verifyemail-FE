"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { Menu, Search, Bell, Moon, Sun, X } from "lucide-react";
import { SidebarContent } from "./sidebar";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { cn, initials } from "@/lib/utils";

const USER = { name: "MindSupernova Labs", email: "labs@mindsupernova.com" };

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
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const { dark, toggle } = useDarkMode();
  React.useEffect(() => setMounted(true), []);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur lg:px-6">
      <button
        onClick={() => setMobileOpen(true)}
        className="rounded-lg p-2 text-muted-foreground hover:bg-muted lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </button>

      {/* Search */}
      <div className="relative hidden max-w-md flex-1 sm:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder="Search lists, emails, domains…"
          className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button onClick={toggle} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Toggle theme">
          {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>
        <button className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Notifications">
          <Bell className="size-5" />
          <span className="absolute right-2 top-2 size-2 rounded-full bg-primary" />
        </button>

        <DropdownMenu
          trigger={
            <button className="ml-1 flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-muted">
              <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {initials(USER.name)}
              </span>
              <span className="hidden text-sm font-medium sm:block">{USER.name}</span>
            </button>
          }
        >
          <div className="px-2.5 py-2">
            <p className="text-sm font-medium">{USER.name}</p>
            <p className="text-xs text-muted-foreground">{USER.email}</p>
          </div>
          <DropdownSeparator />
          <DropdownItem onClick={() => (window.location.href = "/settings/profile")}>Profile</DropdownItem>
          <DropdownItem onClick={() => (window.location.href = "/settings/team")}>Team</DropdownItem>
          <DropdownItem onClick={() => (window.location.href = "/billing")}>Billing</DropdownItem>
          <DropdownSeparator />
          <DropdownItem destructive onClick={() => (window.location.href = "/login")}>
            Sign out
          </DropdownItem>
        </DropdownMenu>
      </div>

      {/* Mobile sidebar drawer */}
      {mounted &&
        mobileOpen &&
        createPortal(
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={() => setMobileOpen(false)} />
            <div className={cn("absolute inset-y-0 left-0 w-64 animate-slide-in-right")}>
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute -right-10 top-4 rounded-lg bg-card p-2 shadow"
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </header>
  );
}

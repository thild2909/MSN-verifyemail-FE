"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MailCheck } from "lucide-react";
import { NAV } from "@/lib/nav";
import { CreditsWidget } from "./credits-widget";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string, match?: string[]) {
  const prefixes = match ?? [href];
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
        <div className="flex size-9 items-center justify-center rounded-lg bg-sidebar-accent">
          <MailCheck className="size-5 text-white" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-bold">Verifly</p>
          <p className="text-[11px] text-sidebar-muted">Email intelligence</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="scrollbar-thin flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {NAV.map((section, i) => (
          <div key={i}>
            {section.title && (
              <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
                {section.title}
              </p>
            )}
            <ul className="space-y-1">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href, item.match);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-sidebar-accent text-white shadow-sm"
                          : "text-sidebar-muted hover:bg-white/5 hover:text-sidebar-foreground",
                      )}
                    >
                      <Icon className="size-[18px] shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {item.soon && (
                        <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-muted">
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

      {/* Credits */}
      <div className="border-t border-sidebar-border p-3">
        <CreditsWidget />
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 lg:block">
      <div className="fixed inset-y-0 left-0 w-64">
        <SidebarContent />
      </div>
    </aside>
  );
}

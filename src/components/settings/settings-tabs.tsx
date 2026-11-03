"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { User, SlidersHorizontal, Users, ShieldCheck } from "lucide-react";
import { getMe } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { IconTile, type Tone } from "./settings-ui";

const PAGES: { label: string; description: string; href: string; icon: React.ElementType; tone: Tone; adminOnly?: boolean }[] = [
  { label: "Profile", description: "Your name and account", href: "/settings/profile", icon: User, tone: "brand" },
  { label: "Security", description: "Password, 2FA, devices", href: "/settings/security", icon: ShieldCheck, tone: "valid" },
  { label: "Users", description: "Team members and roles", href: "/settings/team", icon: Users, tone: "violet", adminOnly: true },
  { label: "Config", description: "API keys and services", href: "/settings/config", icon: SlidersHorizontal, tone: "risky", adminOnly: true },
];

function usePages() {
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: getMe });
  return PAGES.filter((p) => !p.adminOnly || user?.role === "admin");
}

/** Desktop rail: vertical list with icon tiles and one-line descriptions. */
export function SettingsNav() {
  const pathname = usePathname();
  const pages = usePages();
  return (
    <nav aria-label="Settings sections" className="hidden lg:block">
      <div className="sticky top-[5.5rem] space-y-1 rounded-xl border border-border bg-card p-2 shadow-card">
        {pages.map((p) => {
          const active = pathname === p.href || pathname.startsWith(p.href + "/");
          return (
            <Link
              key={p.href}
              href={p.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors",
                active ? "bg-sidebar-active" : "hover:bg-surface",
              )}
            >
              <IconTile icon={p.icon} tone={active ? "brand" : p.tone} size="sm" />
              <span className="min-w-0">
                <span className={cn("block truncate text-sm font-medium", active ? "text-brand" : "text-foreground")}>{p.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{p.description}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Phone / tablet: sideways-scrolling pill row. */
export function SettingsTabs() {
  const pathname = usePathname();
  const pages = usePages();
  return (
    <nav aria-label="Settings sections" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar lg:hidden">
      {pages.map((p) => {
        const active = pathname === p.href || pathname.startsWith(p.href + "/");
        const Icon = p.icon;
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors",
              active ? "border-brand bg-brand/10 text-brand" : "border-border bg-card text-muted-foreground",
            )}
          >
            <Icon className="size-4" strokeWidth={1.75} />
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}

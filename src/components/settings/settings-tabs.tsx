"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Profile", href: "/settings/profile" },
  { label: "Config", href: "/settings/config", adminOnly: true },
  { label: "Users", href: "/settings/team", adminOnly: true },
  { label: "Security", href: "/settings/security" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: getMe });
  const tabs = TABS.filter((t) => !t.adminOnly || user?.role === "admin");

  return (
    <div className="flex gap-1 border-b">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

"use client";
import * as React from "react";
import { Sun, Monitor, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { THEME_STORAGE_KEY } from "./theme-script";

export type ThemePref = "light" | "system" | "dark";

const STORAGE_KEY = THEME_STORAGE_KEY;

interface ThemeCtx {
  theme: ThemePref;
  resolved: "light" | "dark";
  setTheme: (t: ThemePref) => void;
}

const Ctx = React.createContext<ThemeCtx | null>(null);

function systemDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(dark: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemePref>("system");
  const [resolved, setResolved] = React.useState<"light" | "dark">("light");

  // Read the stored preference once mounted (the inline script already painted it).
  React.useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {}
    const pref: ThemePref = saved === "light" || saved === "dark" ? saved : "system";
    setThemeState(pref);
  }, []);

  // Apply + follow the OS while on "system".
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      apply(dark);
      setResolved(dark ? "dark" : "light");
    };
    update();
    if (theme !== "system") return;
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [theme]);

  const setTheme = React.useCallback((t: ThemePref) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {}
  }, []);

  const value = React.useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = React.useContext(Ctx);
  if (ctx) return ctx;
  // Fallback outside the provider: report OS preference, no-op setter.
  return { theme: "system", resolved: systemDark() ? "dark" : "light", setTheme: () => {} };
}

const OPTIONS: { value: ThemePref; label: string; icon: React.ElementType }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

/** Segmented Light / System / Dark switch (pill radiogroup). */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={cn("inline-flex items-center rounded-full border border-border bg-surface p-0.5", className)}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full text-[15px] transition-colors",
              active ? "bg-card text-brand shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon width="1em" height="1em" strokeWidth={1.75} aria-hidden />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

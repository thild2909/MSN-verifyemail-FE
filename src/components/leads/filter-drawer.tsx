"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Mobile slide-over host for a filter panel. On md+ the leads tables keep their
 * inline `<aside>` sidebar; below md that sidebar is `hidden`, so this drawer is
 * how the same filter panel is reached on a phone/tablet. Rendered in a portal
 * with a backdrop, and only mounted while open — so the panel isn't duplicated
 * in the tree on desktop.
 */
export function MobileFilterDrawer({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />
      <aside
        className={cn(
          "absolute inset-y-0 left-0 flex w-[86vw] max-w-xs flex-col overflow-hidden border-r bg-card shadow-2xl animate-slide-in-right",
          className,
        )}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b px-4">
          <span className="text-sm font-semibold">Filters</span>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close filters">
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

/**
 * Open the desktop inline sidebar (toggle) on md+, or the mobile drawer below
 * md. A click handler is client-only, so reading the viewport here is safe and
 * avoids any SSR/hydration flash from a media query in state.
 */
export function openFiltersFor(
  setDesktop: React.Dispatch<React.SetStateAction<boolean>>,
  setMobile: React.Dispatch<React.SetStateAction<boolean>>,
) {
  if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) {
    setDesktop((v) => !v);
  } else {
    setMobile(true);
  }
}

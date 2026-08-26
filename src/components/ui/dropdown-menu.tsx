"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface DropdownMenuProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end";
  /** Prefer opening above the trigger (for bottom-anchored bars). */
  up?: boolean;
  className?: string;
}

const GAP = 4;
const MARGIN = 8;
/** Off-screen resting style so the menu can be measured without flashing. */
const HIDDEN: React.CSSProperties = { position: "fixed", top: -9999, left: -9999, visibility: "hidden" };

/**
 * Click-to-open menu. The panel is rendered in a portal with fixed positioning
 * computed from the trigger, so it escapes any `overflow` clipping (e.g. a
 * table's horizontal scroll container) and is flipped/clamped to stay on-screen.
 */
export function DropdownMenu({ trigger, children, align = "end", up = false, className }: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [style, setStyle] = React.useState<React.CSSProperties>(HIDDEN);

  React.useEffect(() => setMounted(true), []);

  const place = React.useCallback(() => {
    const trig = triggerRef.current;
    const menu = menuRef.current;
    if (!trig || !menu) return;
    const a = trig.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontal: anchor to the requested edge, then clamp into the viewport.
    let left = align === "end" ? a.right - mw : a.left;
    left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, vw - mw - MARGIN));

    // Vertical: below by default; flip above when it would overflow the bottom
    // and there is more room above (or `up` was explicitly requested).
    const overflowsBottom = a.bottom + GAP + mh > vh - MARGIN;
    const openUp = up || (overflowsBottom && a.top > vh - a.bottom);
    let top = openUp ? a.top - GAP - mh : a.bottom + GAP;
    top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, vh - mh - MARGIN));

    setStyle({ position: "fixed", top, left, visibility: "visible" });
  }, [align, up]);

  React.useLayoutEffect(() => {
    if (!open) {
      setStyle(HIDDEN);
      return;
    }
    place();
  }, [open, place]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true); // capture: reposition on scroll in any ancestor
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, place]);

  return (
    <div ref={triggerRef} className="relative inline-block text-left">
      <span onClick={() => setOpen((o) => !o)}>{trigger}</span>
      {open &&
        mounted &&
        createPortal(
          <div
            ref={menuRef}
            className={cn(
              "z-50 min-w-[10rem] animate-fade-in overflow-hidden rounded-lg border bg-popover p-1 shadow-lg",
              className,
            )}
            style={{ ...style, fontFamily: "var(--font-sans), system-ui, sans-serif" }}
            onClick={() => setOpen(false)}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function DropdownItem({
  className,
  destructive,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { destructive?: boolean }) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-normal transition-colors hover:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground disabled:pointer-events-none disabled:opacity-50",
        destructive && "text-destructive hover:bg-destructive/10 [&_svg]:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-border" />;
}

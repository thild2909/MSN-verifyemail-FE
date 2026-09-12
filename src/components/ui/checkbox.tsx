"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

type CheckboxSize = "sm" | "md";

const sizeClasses: Record<CheckboxSize, string> = {
  sm: "size-4", // 16px — dense table rows
  md: "size-[18px]", // 18px — forms, filter toggles
};

const glyphSize: Record<CheckboxSize, string> = {
  sm: "size-3",
  md: "size-3.5",
};

const boxBase =
  "flex shrink-0 items-center justify-center rounded-[5px] border transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out";

function boxState(active: boolean) {
  return active
    ? "border-primary bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(15,23,42,0.12)]"
    : "border-input bg-card";
}

/** The check / indeterminate glyph. Always mounted so it can animate in and out. */
function Glyph({ checked, indeterminate, size }: { checked: boolean; indeterminate?: boolean; size: CheckboxSize }) {
  if (indeterminate) {
    return <span className="h-0.5 w-2.5 rounded-full bg-current" />;
  }
  return (
    <svg
      viewBox="0 0 12 12"
      className={cn(
        glyphSize[size],
        "transition-transform duration-150 ease-out",
        checked ? "scale-100 opacity-100" : "scale-50 opacity-0",
      )}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface CheckboxProps {
  checked: boolean;
  /** Simple toggle callback (fires on any state change). */
  onChange?: () => void;
  /** Value-aware callback; receives the next checked state. */
  onCheckedChange?: (checked: boolean) => void;
  indeterminate?: boolean;
  disabled?: boolean;
  size?: CheckboxSize;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Stop click propagation — on by default so it is safe inside clickable table rows. */
  stopPropagation?: boolean;
}

/**
 * Interactive, accessible checkbox rendered as a button so it works cleanly
 * inside clickable table rows. Prefer this over a raw <input type="checkbox">.
 */
export function Checkbox({
  checked,
  onChange,
  onCheckedChange,
  indeterminate,
  disabled,
  size = "sm",
  className,
  id,
  stopPropagation = true,
  ...aria
}: CheckboxProps) {
  const active = checked || !!indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      id={id}
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-labelledby"]}
      disabled={disabled}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        if (disabled) return;
        if (onChange) onChange();
        else onCheckedChange?.(!checked);
      }}
      className={cn(
        boxBase,
        sizeClasses[size],
        boxState(active),
        !active && !disabled && "hover:border-primary/60 hover:bg-primary/[0.04]",
        "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95",
        disabled && "cursor-not-allowed opacity-50 active:scale-100",
        className,
      )}
    >
      <Glyph checked={checked} indeterminate={indeterminate} size={size} />
    </button>
  );
}

/**
 * Presentational check indicator (non-interactive) for use inside a clickable
 * <label> row that already owns the click + a screen-reader-only input.
 * Reacts to the parent's `group` hover.
 */
export function CheckboxIndicator({
  checked,
  indeterminate,
  size = "sm",
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  size?: CheckboxSize;
  className?: string;
}) {
  const active = checked || !!indeterminate;
  return (
    <span
      className={cn(
        boxBase,
        sizeClasses[size],
        boxState(active),
        !active && "group-hover:border-primary/50",
        className,
      )}
    >
      <Glyph checked={checked} indeterminate={indeterminate} size={size} />
    </span>
  );
}

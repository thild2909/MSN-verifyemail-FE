import * as React from "react";
import { cn } from "@/lib/utils";

/* Shared building blocks for every /settings page. */

export const TONES = {
  brand: "bg-brand/10 text-brand",
  valid: "bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]",
  invalid: "bg-[hsl(var(--invalid)/0.1)] text-[hsl(var(--invalid))]",
  risky: "bg-[hsl(var(--risky)/0.14)] text-[hsl(var(--risky))]",
  violet: "bg-[hsl(280_70%_60%/0.12)] text-[hsl(280_65%_55%)] dark:text-[hsl(280_80%_75%)]",
  sky: "bg-[hsl(199_89%_48%/0.12)] text-[hsl(199_89%_40%)] dark:text-[hsl(199_90%_65%)]",
  muted: "bg-surface text-muted-foreground",
} as const;
export type Tone = keyof typeof TONES;

export function IconTile({ icon: Icon, tone = "brand", size = "md", className }: { icon: React.ElementType; tone?: Tone; size?: "sm" | "md"; className?: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        size === "sm" ? "size-7 rounded-md" : "size-9 rounded-lg",
        TONES[tone],
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} strokeWidth={1.75} />
    </span>
  );
}

/** Card with an icon-tile heading, a divider and a padded body. */
export function SettingsCard({
  icon, tone, title, description, aside, children, footer, className, bodyClassName, id,
}: {
  icon: React.ElementType;
  tone?: Tone;
  title: React.ReactNode;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-24 overflow-hidden rounded-xl border border-border bg-card shadow-card", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <IconTile icon={icon} tone={tone} />
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-snug">{title}</h2>
            {description && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      {children !== undefined && (
        // A flush body (`p-0`) must also drop the sm: padding, so don't merge the default in.
        <div className={cn(/\bp-0\b/.test(bodyClassName ?? "") ? "" : "p-4 sm:p-5", bodyClassName)}>{children}</div>
      )}
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface/50 px-4 py-3 sm:px-5">{footer}</div>
      )}
    </section>
  );
}

/** Label + control + optional hint, stacked. */
export function Field({
  label, htmlFor, hint, error, aside, children, className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-foreground">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <p className="text-[11px] text-[hsl(var(--invalid))]">{error}</p>
      ) : (
        hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** A bordered row: icon tile, title/description, trailing control. */
export function SettingRow({
  icon, tone = "muted", title, description, children, className,
}: {
  icon: React.ElementType;
  tone?: Tone;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-border bg-card p-3", className)}>
      <IconTile icon={icon} tone={tone} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** Small coloured pill. */
export function Pill({ tone = "muted", dot, children, className }: { tone?: Tone; dot?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold capitalize", TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* Soft avatar colour, stable per name, legible in both themes. */
const AVATAR_TONES: Tone[] = ["brand", "valid", "risky", "violet", "sky"];
export function avatarTone(name: string): Tone {
  return AVATAR_TONES[[...(name || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
}

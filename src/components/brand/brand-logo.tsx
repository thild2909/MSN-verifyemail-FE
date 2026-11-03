import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Brand — Mind Supernova
 *
 * The mark is the head + supernova glyph (public/icons/mark.png, trimmed
 * from public/icons/black.webp) sitting on a rounded tile. Light mode: white
 * tile, black glyph. Dark mode: ink tile, glyph inverted to white. The same
 * tile is the favicon / PWA icon (public/icons/*), so the brand reads the
 * same in a browser tab, on a home screen and inside the product.
 * ------------------------------------------------------------------ */

const TILE_SIZE = {
  xs: "size-5 rounded-[5px] p-0.5",
  sm: "size-8 rounded-lg p-1",
  md: "size-9 rounded-[10px] p-1.5",
  lg: "size-14 rounded-2xl p-2.5",
} as const;

export type BrandSize = keyof typeof TILE_SIZE;

/** The brand tile. */
export function BrandMark({ size = "sm", className }: { size?: BrandSize; className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-white shadow-xs ring-1 ring-inset ring-black/10 dark:bg-[#111a33] dark:ring-white/10",
        TILE_SIZE[size],
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand asset */}
      <img
        src="/icons/mark.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="size-full select-none object-contain dark:invert"
      />
    </span>
  );
}

/** Full lockup: tile + wordmark + optional tagline. */
export function BrandLockup({
  size = "sm",
  subtitle = "Lead Finder",
  className,
  compact,
}: {
  size?: BrandSize;
  subtitle?: string | null;
  className?: string;
  /** Hide the text, keep only the tile (collapsed sidebar). */
  compact?: boolean;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <BrandMark size={size} />
      {!compact && (
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[15px] font-semibold tracking-tight text-foreground">Mind Supernova</span>
          {subtitle && <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>}
        </span>
      )}
    </span>
  );
}

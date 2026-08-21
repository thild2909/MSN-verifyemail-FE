"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Styled select. Renders a button trigger + a fully-themed dropdown listbox
 * (native <select> option lists can't be styled across browsers). Keeps the
 * native-ish API — pass <option> children and read `e.target.value` in
 * onChange — so existing call sites work unchanged. Controlled via `value`,
 * or uncontrolled via `defaultValue`.
 */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

interface Opt { value: string; label: React.ReactNode; text: string; disabled?: boolean }

/** Flatten children (arrays, fragments, mapped lists) into a list of options. */
function extractOptions(children: React.ReactNode): Opt[] {
  const out: Opt[] = [];
  const walk = (node: React.ReactNode) => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      const el = child as React.ReactElement<any>;
      if (el.type === "option") {
        const label = el.props.children;
        out.push({
          value: String(el.props.value ?? ""),
          label,
          text: typeof label === "string" ? label : String(label ?? el.props.value ?? ""),
          disabled: el.props.disabled,
        });
      } else if (el.props?.children) {
        walk(el.props.children);
      }
    });
  };
  walk(children);
  return out;
}

const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  ({ className, children, value, defaultValue, onChange, disabled, id, name, ...rest }, ref) => {
    const options = React.useMemo(() => extractOptions(children), [children]);

    const isControlled = value !== undefined;
    const [internal, setInternal] = React.useState<string>(() =>
      String(defaultValue ?? (value !== undefined ? value : options[0]?.value ?? "")),
    );
    const current = String(isControlled ? value : internal);
    const selected = options.find((o) => o.value === current) ?? options[0];

    const [open, setOpen] = React.useState(false);
    const [activeIndex, setActiveIndex] = React.useState(0);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const listRef = React.useRef<HTMLDivElement>(null);
    const [coords, setCoords] = React.useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
    const typeahead = React.useRef({ buffer: "", timer: 0 as unknown as ReturnType<typeof setTimeout> });

    React.useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement);

    const reposition = React.useCallback(() => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const spaceBelow = vh - r.bottom;
      const spaceAbove = r.top;
      const openUp = spaceBelow < Math.min(264, 200) && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(264, (openUp ? spaceAbove : spaceBelow) - 8));
      setCoords({
        left: r.left,
        width: r.width,
        top: openUp ? undefined : r.bottom + 4,
        bottom: openUp ? vh - r.top + 4 : undefined,
        maxHeight,
      });
    }, []);

    // Position + keep glued to the trigger while open.
    React.useEffect(() => {
      if (!open) return;
      reposition();
      const onScroll = () => reposition();
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", onScroll);
      return () => {
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onScroll);
      };
    }, [open, reposition]);

    // Outside click / escape.
    React.useEffect(() => {
      if (!open) return;
      const onDown = (e: MouseEvent) => {
        if (triggerRef.current?.contains(e.target as Node) || listRef.current?.contains(e.target as Node)) return;
        setOpen(false);
      };
      document.addEventListener("mousedown", onDown);
      return () => document.removeEventListener("mousedown", onDown);
    }, [open]);

    // Keep the active option in view.
    React.useEffect(() => {
      if (!open) return;
      listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
    }, [open, activeIndex]);

    const openMenu = () => {
      if (disabled) return;
      const idx = options.findIndex((o) => o.value === current);
      setActiveIndex(idx >= 0 ? idx : 0);
      setOpen(true);
    };

    const choose = (opt: Opt) => {
      if (opt.disabled) return;
      if (!isControlled) setInternal(opt.value);
      onChange?.({ target: { value: opt.value, name } } as unknown as React.ChangeEvent<HTMLSelectElement>);
      setOpen(false);
      triggerRef.current?.focus();
    };

    const step = (dir: 1 | -1) => {
      setActiveIndex((i) => {
        let n = i;
        for (let k = 0; k < options.length; k++) {
          n = (n + dir + options.length) % options.length;
          if (!options[n]?.disabled) return n;
        }
        return i;
      });
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openMenu();
        }
        return;
      }
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); step(1); break;
        case "ArrowUp": e.preventDefault(); step(-1); break;
        case "Home": e.preventDefault(); setActiveIndex(options.findIndex((o) => !o.disabled)); break;
        case "End": e.preventDefault(); { const last = [...options].reverse().findIndex((o) => !o.disabled); setActiveIndex(last < 0 ? 0 : options.length - 1 - last); } break;
        case "Enter": case " ": e.preventDefault(); e.stopPropagation(); if (options[activeIndex]) choose(options[activeIndex]); break;
        // Stop Escape here so a host (e.g. Dialog) doesn't also close on it.
        case "Escape": e.preventDefault(); e.stopPropagation(); setOpen(false); triggerRef.current?.focus(); break;
        case "Tab": setOpen(false); break;
        default:
          if (e.key.length === 1) {
            const t = typeahead.current;
            t.buffer += e.key.toLowerCase();
            clearTimeout(t.timer);
            t.timer = setTimeout(() => (t.buffer = ""), 500);
            const found = options.findIndex((o) => !o.disabled && o.text.toLowerCase().startsWith(t.buffer));
            if (found >= 0) setActiveIndex(found);
          }
      }
    };

    return (
      <div className="relative">
        <button
          {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
          ref={triggerRef}
          type="button"
          id={id}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={onKeyDown}
          className={cn(
            "flex h-10 w-full items-center appearance-none rounded-lg border border-input bg-card px-3 pr-9 py-2 text-left text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate">{selected?.label ?? <span className="text-muted-foreground">Select…</span>}</span>
        </button>
        <ChevronDown className={cn("pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-transform", open && "rotate-180")} />

        {open && coords && createPortal(
          <div
            ref={listRef}
            role="listbox"
            aria-activedescendant={`opt-${activeIndex}`}
            style={{ position: "fixed", left: coords.left, top: coords.top, bottom: coords.bottom, width: coords.width, maxHeight: coords.maxHeight }}
            className="z-[100] animate-fade-in overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg scrollbar-thin"
          >
            {options.length === 0 ? (
              <div className="px-2.5 py-2 text-sm text-muted-foreground">No options</div>
            ) : options.map((o, i) => {
              const isSel = o.value === current;
              const isActive = i === activeIndex;
              return (
                <div
                  key={`${o.value}-${i}`}
                  id={`opt-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={isSel}
                  aria-disabled={o.disabled}
                  onMouseEnter={() => !o.disabled && setActiveIndex(i)}
                  onClick={() => choose(o)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                    o.disabled && "cursor-not-allowed opacity-50",
                    isActive && !o.disabled && "bg-accent text-accent-foreground",
                    isSel && "font-medium",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">{isSel && <Check className="size-4 text-primary" />}</span>
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
      </div>
    );
  },
);
Select.displayName = "Select";

export { Select };

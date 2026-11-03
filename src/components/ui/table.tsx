import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ColHead } from "@/components/common/col-head";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-x-auto scrollbar-thin">
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />,
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn("border-b border-border/60 transition-colors hover:bg-surface/60 data-[state=selected]:bg-brand/[0.06]", className)}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

type TableHeadProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
  /** Header icon: auto-picked from a plain-text label; pass a glyph to override or `false` to hide. */
  icon?: LucideIcon | false;
};

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, children, icon, ...props }, ref) => {
    const alignRight = /\btext-right\b/.test(className ?? "");
    const alignCenter = /\btext-center\b/.test(className ?? "");
    return (
      <th
        ref={ref}
        className={cn(
          "h-11 whitespace-nowrap bg-surface px-3 text-left align-middle text-[13px] font-normal text-muted-foreground sm:px-4 [&:has([role=checkbox])]:pr-0",
          className,
        )}
        {...props}
      >
        {typeof children === "string" && children.trim() ? (
          <ColHead label={children} icon={icon} align={alignRight ? "right" : alignCenter ? "center" : "left"} />
        ) : (
          children
        )}
      </th>
    );
  },
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn("px-3 py-2.5 align-middle sm:px-4 sm:py-3", className)} {...props} />
  ),
);
TableCell.displayName = "TableCell";

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };

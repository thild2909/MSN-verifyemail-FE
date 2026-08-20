import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

/**
 * Full-bleed shell for the Find Leads platform. Unlike the (app) group, it
 * locks to the viewport height and does NOT constrain width with max-w — the
 * lead-intelligence UI owns the whole canvas and manages its own independently
 * scrolling filter sidebar + results table.
 */
export default function LeadsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

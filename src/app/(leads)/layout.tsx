import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MobileNavProvider, MobileTabBar } from "@/components/layout/mobile-nav";

/**
 * Full-bleed shell for the Find Leads platform. Unlike the (app) group, it
 * locks to the viewport height (dvh, so mobile browser chrome is accounted for)
 * and does NOT constrain width with max-w — the lead-intelligence UI owns the
 * whole canvas and manages its own independently scrolling filter sidebar +
 * results table. On mobile the main reserves room for the bottom tab bar so the
 * tool's own bottom toolbars never hide behind it.
 */
export default function LeadsLayout({ children }: { children: React.ReactNode }) {
  return (
    <MobileNavProvider>
      <div className="flex h-[100dvh] overflow-hidden bg-background pl-safe pr-safe">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden pb-nav lg:pb-0">{children}</main>
        </div>
        <MobileTabBar />
      </div>
    </MobileNavProvider>
  );
}

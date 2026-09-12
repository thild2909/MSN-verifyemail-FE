import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MobileNavProvider, MobileTabBar } from "@/components/layout/mobile-nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <MobileNavProvider>
      <div className="flex min-h-[100dvh] bg-background pl-safe pr-safe">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 px-4 py-5 lg:px-8 lg:py-8">
            <div className="mx-auto max-w-7xl">{children}</div>
            {/* Clearance so page content is never hidden behind the bottom tab bar. */}
            <div className="pb-nav lg:hidden" aria-hidden />
          </main>
        </div>
        <MobileTabBar />
      </div>
    </MobileNavProvider>
  );
}

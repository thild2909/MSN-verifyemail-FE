import { PageHeader } from "@/components/common/page-header";
import { FinderTabs } from "@/components/finder/finder-tabs";

export const metadata = { title: "Email Finder" };

export default function FinderPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Email Finder"
        subtitle="Discover professional emails one at a time, or in bulk from a CSV/Excel of contacts."
      />
      <FinderTabs />
    </div>
  );
}

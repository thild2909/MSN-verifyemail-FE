import { PageHeader } from "@/components/common/page-header";
import { SettingsNav, SettingsTabs } from "@/components/settings/settings-tabs";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Manage your profile, security, team and workspace configuration." />
      <SettingsTabs />
      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <SettingsNav />
        <div className="min-w-0 max-w-4xl">{children}</div>
      </div>
    </div>
  );
}

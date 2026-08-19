import { PageHeader } from "@/components/common/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Manage your profile, team, and security preferences." />
      <SettingsTabs />
      <div className="max-w-3xl">{children}</div>
    </div>
  );
}

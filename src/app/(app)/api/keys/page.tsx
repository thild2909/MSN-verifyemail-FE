import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { ApiKeysManager } from "@/components/api/api-keys-manager";

export const metadata = { title: "API Keys" };

export default function ApiKeysPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/api" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> API
        </Link>
        <PageHeader title="API Keys & Webhooks" subtitle="Create keys, rotate secrets, and configure event webhooks." />
      </div>
      <ApiKeysManager />
    </div>
  );
}

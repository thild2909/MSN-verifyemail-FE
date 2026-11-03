import Link from "next/link";
import { BookOpen } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { buttonVariants } from "@/components/ui/button";
import { ApiKeysManager } from "@/components/api/api-keys-manager";

export const metadata = { title: "API Keys" };

export default function ApiKeysPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/api"
        title="API keys & webhooks"
        subtitle="Create keys, rotate secrets, and configure event webhooks."
        actions={<Link href="/api/docs" className={buttonVariants({ variant: "outline" })}><BookOpen /> API docs</Link>}
      />
      <ApiKeysManager />
    </div>
  );
}

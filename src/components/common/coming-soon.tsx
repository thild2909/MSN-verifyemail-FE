import { Sparkles } from "lucide-react";
import { PageHeader } from "./page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export function ComingSoon({
  title,
  subtitle,
  features,
}: {
  title: string;
  subtitle: string;
  features: { title: string; description: string }[];
}) {
  return (
    <div className="space-y-8">
      <PageHeader title={title} subtitle={subtitle} actions={<Badge>Coming soon</Badge>} />

      <Card className="flex flex-col items-center justify-center px-6 py-14 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Sparkles className="size-7" />
        </div>
        <h2 className="text-lg font-semibold">This module is on the roadmap</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          The architecture is in place — data models, navigation, and API surface are ready. The
          interactive experience ships in an upcoming release.
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <Card key={f.title} className="p-5">
            <h3 className="text-sm font-semibold">{f.title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{f.description}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

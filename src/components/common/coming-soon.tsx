import { Sparkles, Check } from "lucide-react";
import { PageHeader } from "./page-header";
import { Card } from "@/components/ui/card";
import { IconTile, Pill, type Tone } from "./kit";

const ROTATE: Tone[] = ["brand", "valid", "sky", "risky", "violet", "invalid"];

export function ComingSoon({
  title,
  subtitle,
  features,
  preview,
}: {
  title: string;
  subtitle: string;
  features: { title: string; description: string; icon?: React.ElementType }[];
  /** Optional illustrative block shown in the hero, e.g. a mock breakdown. */
  preview?: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} subtitle={subtitle} status={<Pill tone="brand" dot>Coming soon</Pill>} />

      {/* Hero */}
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand/[0.07] via-transparent to-[hsl(280_70%_60%/0.06)]" />
        <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
          <div>
            <span className="flex size-12 items-center justify-center rounded-xl border border-border bg-card text-brand shadow-xs">
              <Sparkles className="size-5" strokeWidth={1.75} />
            </span>
            <h2 className="mt-4 text-xl font-semibold tracking-tight">This module is on the roadmap</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              The architecture is in place: data models, navigation, and API surface are ready. The interactive experience ships in an upcoming release.
            </p>
            <ul className="mt-4 space-y-1.5 text-sm">
              {["Data model ready", "Navigation wired", "API surface defined"].map((x) => (
                <li key={x} className="flex items-center gap-2">
                  <span className="flex size-4 items-center justify-center rounded-full bg-[hsl(var(--valid)/0.14)]">
                    <Check className="size-3 text-[hsl(var(--valid))]" strokeWidth={2.5} />
                  </span>
                  {x}
                </li>
              ))}
            </ul>
          </div>
          {preview && <div className="min-w-0">{preview}</div>}
        </div>
      </Card>

      {/* Features */}
      <div>
        <p className="mb-3 text-sm font-semibold">What&apos;s planned</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <Card key={f.title} className="p-5">
              <IconTile icon={f.icon ?? Sparkles} tone={ROTATE[i % ROTATE.length]} />
              <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.description}</p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

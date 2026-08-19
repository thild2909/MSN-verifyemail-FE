import { PageHeader } from "@/components/common/page-header";
import { SingleVerifyCard } from "@/components/verification/single-verify-card";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, XCircle, AlertTriangle, HelpCircle } from "lucide-react";

const LEGEND = [
  { icon: CheckCircle2, tone: "text-[hsl(var(--valid))]", label: "Valid", desc: "Mailbox verified deliverable — safe to send." },
  { icon: XCircle, tone: "text-[hsl(var(--invalid))]", label: "Invalid", desc: "Confirmed undeliverable — remove from your list." },
  { icon: AlertTriangle, tone: "text-[hsl(var(--risky))]", label: "Risky", desc: "Catch-all, role, or inconclusive — send with caution." },
  { icon: HelpCircle, tone: "text-muted-foreground", label: "Unknown", desc: "Verification could not reach a confident result." },
];

export default function SingleVerificationPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Single Email Verification"
        subtitle="Run a full multi-signal check on one address in real time."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <SingleVerifyCard />
        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-semibold">How we classify results</h3>
            <div className="mt-4 space-y-4">
              {LEGEND.map(({ icon: Icon, tone, label, desc }) => (
                <div key={label} className="flex gap-3">
                  <Icon className={`mt-0.5 size-5 shrink-0 ${tone}`} />
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-sm text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-6 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              Every result combines syntax, domain, DNS, MX, disposable/role signals, and — with Deep
              Scan — live SMTP &amp; catch-all detection. No single signal decides the outcome.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

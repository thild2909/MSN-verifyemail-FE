import { Inbox, PieChart, ShieldCheck, FileSearch, TrendingUp, BellRing } from "lucide-react";
import { ComingSoon } from "@/components/common/coming-soon";

export const metadata = { title: "Inbox Placement" };

/** Illustrative only (labelled "Preview"): shows the shape of the planned breakdown, not real data. */
function PlacementPreview() {
  const rows = [
    { name: "Gmail", inbox: 82, spam: 12 },
    { name: "Outlook", inbox: 74, spam: 18 },
    { name: "Yahoo", inbox: 69, spam: 22 },
  ];
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">Placement by provider</p>
        <span className="rounded-md border border-dashed border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Preview
        </span>
      </div>
      <ul className="space-y-3" aria-hidden>
        {rows.map((r) => (
          <li key={r.name}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium">{r.name}</span>
              <span className="text-muted-foreground">inbox · spam · missing</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-border">
              <div className="h-full bg-[hsl(var(--valid))]" style={{ width: `${r.inbox}%` }} />
              <div className="h-full bg-[hsl(var(--risky))]" style={{ width: `${r.spam}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[hsl(var(--valid))]" /> Inbox</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[hsl(var(--risky))]" /> Spam</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-border" /> Missing</span>
      </div>
    </div>
  );
}

export default function InboxPlacementPage() {
  return (
    <ComingSoon
      title="Inbox placement"
      subtitle="See where your campaigns land: inbox, spam, or promotions across major providers."
      preview={<PlacementPreview />}
      features={[
        { title: "Seed list testing", description: "Send to seed inboxes across Gmail, Outlook, Yahoo and more.", icon: Inbox },
        { title: "Placement breakdown", description: "Per-provider inbox vs. spam vs. missing rates.", icon: PieChart },
        { title: "Authentication checks", description: "SPF, DKIM, and DMARC alignment for each send.", icon: ShieldCheck },
        { title: "Content analysis", description: "Spam-trigger scoring on subject lines and body.", icon: FileSearch },
        { title: "Historical trends", description: "Track deliverability over time by mailbox provider.", icon: TrendingUp },
        { title: "Alerts", description: "Get notified when placement drops below a threshold.", icon: BellRing },
      ]}
    />
  );
}

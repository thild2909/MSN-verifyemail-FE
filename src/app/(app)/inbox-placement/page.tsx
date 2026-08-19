import { ComingSoon } from "@/components/common/coming-soon";

export const metadata = { title: "Inbox Placement" };

export default function InboxPlacementPage() {
  return (
    <ComingSoon
      title="Inbox Placement"
      subtitle="See where your campaigns land — inbox, spam, or promotions — across major providers."
      features={[
        { title: "Seed list testing", description: "Send to seed inboxes across Gmail, Outlook, Yahoo and more." },
        { title: "Placement breakdown", description: "Per-provider inbox vs. spam vs. missing rates." },
        { title: "Authentication checks", description: "SPF, DKIM, and DMARC alignment for each send." },
        { title: "Content analysis", description: "Spam-trigger scoring on subject lines and body." },
        { title: "Historical trends", description: "Track deliverability over time by mailbox provider." },
        { title: "Alerts", description: "Get notified when placement drops below a threshold." },
      ]}
    />
  );
}

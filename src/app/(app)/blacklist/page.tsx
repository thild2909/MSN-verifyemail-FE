import { ComingSoon } from "@/components/common/coming-soon";

export const metadata = { title: "Blacklist Monitor" };

export default function BlacklistPage() {
  return (
    <ComingSoon
      title="Blacklist Monitor"
      subtitle="Continuously monitor your sending domains and IPs against major DNS blacklists."
      features={[
        { title: "Multi-list coverage", description: "Check Spamhaus, Barracuda, SORBS, and 40+ RBLs." },
        { title: "Domain & IP monitoring", description: "Watch every sending identity from one dashboard." },
        { title: "Instant alerts", description: "Email and webhook notifications the moment you're listed." },
        { title: "Delisting guidance", description: "Step-by-step removal instructions per provider." },
        { title: "Reputation history", description: "Track listing events and resolution over time." },
        { title: "Scheduled scans", description: "Automated re-checks at your chosen interval." },
      ]}
    />
  );
}

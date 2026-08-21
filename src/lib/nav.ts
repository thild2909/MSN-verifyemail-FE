import {
  MailCheck,
  Search,
  Radar,
  Inbox,
  ShieldAlert,
  Code2,
  BarChart3,
  Settings,
  CreditCard,
  Plug,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  soon?: boolean;
  /** Additional path prefixes that should mark this item active. */
  match?: string[];
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    items: [
      { label: "Email Verification", href: "/verification", icon: MailCheck, match: ["/verification", "/dashboard"] },
      { label: "Email Finder", href: "/finder", icon: Search },
      { label: "Find Leads", href: "/find-leads", icon: Radar },
      { label: "Inbox Placement", href: "/inbox-placement", icon: Inbox, soon: true },
      { label: "Blacklist Monitor", href: "/blacklist", icon: ShieldAlert, soon: true },
    ],
  },
  {
    title: "Developer",
    items: [
      { label: "API", href: "/api", icon: Code2, match: ["/api"] },
      { label: "Integrations", href: "/integrations", icon: Plug },
      { label: "Analytics", href: "/analytics", icon: BarChart3 },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "Billing / Credits", href: "/billing", icon: CreditCard, match: ["/billing", "/credits"] },
      { label: "Settings", href: "/settings", icon: Settings, match: ["/settings"] },
    ],
  },
];

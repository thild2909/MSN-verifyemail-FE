import {
  MailCheck,
  Search,
  Radar,
  ListChecks,
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
    title: "Email",
    items: [
      { label: "Email verification", href: "/verification", icon: MailCheck, match: ["/verification", "/dashboard"] },
      { label: "Email finder", href: "/finder", icon: Search },
    ],
  },
  {
    title: "Prospecting",
    items: [
      { label: "Find leads", href: "/find-leads", icon: Radar },
      { label: "Lists", href: "/lists", icon: ListChecks, match: ["/lists"] },
    ],
  },
  {
    title: "Deliverability",
    items: [
      { label: "Inbox placement", href: "/inbox-placement", icon: Inbox, soon: true },
      { label: "Blacklist monitor", href: "/blacklist", icon: ShieldAlert },
      { label: "Analytics", href: "/analytics", icon: BarChart3 },
    ],
  },
  {
    title: "Developer",
    items: [
      { label: "API", href: "/api", icon: Code2, match: ["/api"] },
      { label: "Integrations", href: "/integrations", icon: Plug },
    ],
  },
  {
    title: "Workspace",
    items: [
      { label: "Settings", href: "/settings", icon: Settings, match: ["/settings"] },
      { label: "Billing & credits", href: "/billing", icon: CreditCard, match: ["/billing", "/credits"] },
    ],
  },
];

/** Flat lookup used by the top-bar quick search. */
export const NAV_ITEMS: NavItem[] = NAV.flatMap((s) => s.items);

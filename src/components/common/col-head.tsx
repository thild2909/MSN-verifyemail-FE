import * as React from "react";
import {
  Mail, User, Users, Briefcase, Crown, Building2, Factory, MapPin, Globe, Linkedin, Phone, CircleCheck,
  Gauge, CalendarDays, Clock, DollarSign, Database, Server, Code2, Timer, CheckCircle2, XCircle,
  AlertTriangle, HelpCircle, Hash, Key, Zap, Tag, ListChecks, Layers, Activity, Wallet, Shield, Sparkles,
  FileText, Percent, Network, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Column-header iconography, modelled on the Outreach suite's tables: every
 * header carries a small glyph whose hue says what kind of value lives in the
 * column (people = indigo, mail = brand, time & scores = amber, money & good
 * outcomes = green, web / infra / contact = blue, structure = violet,
 * tags = pink, problems = red). All hues are theme-aware.
 */
const TONE = {
  people: "text-[hsl(234_78%_60%)] dark:text-[hsl(234_90%_76%)]",
  mail: "text-brand",
  time: "text-[hsl(var(--risky))]",
  ok: "text-[hsl(var(--valid))]",
  infra: "text-[hsl(199_89%_40%)] dark:text-[hsl(199_90%_65%)]",
  structure: "text-[hsl(280_62%_55%)] dark:text-[hsl(280_80%_76%)]",
  tags: "text-[hsl(330_72%_54%)] dark:text-[hsl(330_85%_72%)]",
  bad: "text-[hsl(var(--invalid))]",
  neutral: "text-muted-foreground",
} as const;
type ToneKey = keyof typeof TONE;

/** First match wins — order specific → generic. Matched on the lower-cased label. */
const RULES: [RegExp, LucideIcon, ToneKey][] = [
  [/linkedin/, Linkedin, "infra"],
  [/company (employees|size)|employees|headcount/, Users, "people"],
  [/company (phone)|phone|mobile|tel\b/, Phone, "infra"],
  [/company email|e-?mail|mailbox/, Mail, "mail"],
  [/company industry|industry|sector/, Factory, "tags"],
  [/^invalid|bounce|failed|blocked|error/, XCircle, "bad"],
  [/^valid|deliverable|clean/, CheckCircle2, "ok"],
  [/risky|catch.?all|warning/, AlertTriangle, "time"],
  [/unknown/, HelpCircle, "neutral"],
  [/seniority|level/, Crown, "structure"],
  [/job|title|role|position/, Briefcase, "structure"],
  [/company|organi[sz]ation|account|employer/, Building2, "structure"],
  [/name|contact|person|people|owner|member|user/, User, "people"],
  [/location|country|city|region|address|geo/, MapPin, "infra"],
  [/website|domain|url|site|web/, Globe, "infra"],
  [/sending ip|proxy|\bip\b|server|host|\bmx\b/, Server, "infra"],
  [/latency|duration|speed/, Timer, "time"],
  [/code|response|http/, Code2, "infra"],
  [/status|state|verdict|result|health/, CircleCheck, "ok"],
  [/score|confidence|fit|match|quality|icp/, Gauge, "time"],
  [/rate|percent|%/, Percent, "ok"],
  [/posted|created|updated|date|joined|since|day/, CalendarDays, "time"],
  [/last|time|checked|seen|when|ago/, Clock, "time"],
  [/balance|wallet/, Wallet, "ok"],
  [/salary|revenue|price|cost|credit|amount|fund|spend/, DollarSign, "ok"],
  [/source|provider|via|engine/, Database, "structure"],
  [/key|token|secret/, Key, "mail"],
  [/event|webhook|trigger/, Zap, "time"],
  [/tag|label|categor/, Tag, "tags"],
  [/list/, ListChecks, "structure"],
  [/operation|type|kind|method/, Layers, "structure"],
  [/progress|activity|usage|request/, Activity, "infra"],
  [/role|permission|access|security/, Shield, "infra"],
  [/\bai\b|insight|signal|intent/, Sparkles, "structure"],
  [/note|description|summary|about/, FileText, "tags"],
  [/network|group/, Network, "structure"],
  [/total|count|records|rows|emails|leads|#/, Hash, "mail"],
];

export function colHeadMeta(label: string): { icon: LucideIcon; tone: string } | null {
  const t = label.trim().toLowerCase();
  if (!t) return null;
  const hit = RULES.find(([re]) => re.test(t));
  return hit ? { icon: hit[1], tone: TONE[hit[2]] } : null;
}

/**
 * Header label with its meaning-coloured icon. Pass `icon` to override the
 * automatic pick, or `icon={false}` to render the label alone.
 */
export function ColHead({
  label, icon, align, className, children,
}: {
  label: string;
  icon?: LucideIcon | false;
  align?: "left" | "center" | "right";
  className?: string;
  /** Extra trailing content (e.g. a sort arrow or info tooltip). */
  children?: React.ReactNode;
}) {
  const auto = icon === undefined ? colHeadMeta(label) : null;
  const Glyph = icon || auto?.icon;
  const tone = icon ? TONE.neutral : auto?.tone;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        align === "center" && "justify-center",
        align === "right" && "flex-row-reverse",
        className,
      )}
    >
      {Glyph && <Glyph aria-hidden className={cn("size-3.5 shrink-0", tone)} strokeWidth={1.9} />}
      <span>{label}</span>
      {children}
    </span>
  );
}

/** Shared table rhythm (Outreach-suite style): sentence-case 13px headers on a surface band. */
export const TH_ROW = "bg-surface text-left text-[13px] font-normal normal-case tracking-normal text-muted-foreground";

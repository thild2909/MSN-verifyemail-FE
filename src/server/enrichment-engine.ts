/**
 * Enrichment engine — runs one enrichment column against one row and returns a
 * Clay-style cell: the found value plus the WATERFALL of providers tried, the
 * winning source, and a confidence. Verification-backed columns (work email,
 * verify) call the same backend + caches the finder uses, so repeat lookups on
 * a domain are cheap; the rest are deterministic mock providers.
 */
import "server-only";
import { seededRandom, initials } from "@/lib/utils";
import { buildCandidates, cleanDomain } from "@/lib/finder/patterns";
import { cachedVerify } from "./verification";
import { columnSpec } from "@/lib/enrich/columns";
import type {
  EnrichCell, EnrichColumnKind, EnrichRecordType, WaterfallStep,
} from "@/lib/types";

/* --------------------------- domain / firmographics ---------------------- */

export function companyToDomain(value: string): string {
  const s = (value ?? "").trim().toLowerCase();
  if (!s) return "";
  const d = cleanDomain(s);
  if (d.includes(".") && !d.includes(" ")) return d;
  const slug = s
    .replace(/\b(inc|llc|ltd|corp|co|gmbh|group|company|holdings|labs)\b/gi, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
  return slug ? `${slug}.com` : "";
}

const INDUSTRIES = ["Software", "Fintech", "E-commerce", "Healthcare", "Marketing & Advertising", "Manufacturing", "Logistics", "Cybersecurity", "Education", "Real Estate"];
const SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000"];
const LOCATIONS = ["San Francisco, US", "New York, US", "London, UK", "Berlin, DE", "Singapore, SG", "Toronto, CA", "Sydney, AU", "Amsterdam, NL"];
const REVENUES = ["$1M-$5M", "$5M-$10M", "$10M-$50M", "$50M-$100M", "$100M+"];
const TECHS = ["AWS", "Python", "React", "Kubernetes", "Snowflake", "Node.js", "GCP", "PostgreSQL", "TypeScript", "Segment"];

const pick = <T>(pool: T[], domain: string, salt: string): T => pool[Math.floor(seededRandom(`${domain}:${salt}`) * pool.length)];

export interface Firmographics {
  industry: string; size: string; location: string; revenue: string; founded: number;
}

function firmographics(domain: string): Firmographics {
  return {
    industry: pick(INDUSTRIES, domain, "industry"),
    size: pick(SIZES, domain, "size"),
    location: pick(LOCATIONS, domain, "location"),
    revenue: pick(REVENUES, domain, "revenue"),
    founded: 1990 + Math.floor(seededRandom(`${domain}:founded`) * 33),
  };
}

function companyTechnologies(domain: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < TECHS.length && out.length < 4; i++) {
    if (seededRandom(`${domain}:tech:${i}`) < 0.4) out.push(TECHS[i]);
  }
  if (out.length === 0) out.push(pick(TECHS, domain, "tech:fallback"));
  return out;
}

/* -------------------------------- row context ---------------------------- */

export interface RowContext {
  recordType: EnrichRecordType;
  fields: Record<string, string>;
  first: string;
  last: string;
  companyName: string;
  domain: string;
  /** Email resolved so far (from import or a prior find_work_email column). */
  resolvedEmail: string | null;
}

export function buildRowContext(recordType: EnrichRecordType, fields: Record<string, string>): RowContext {
  const companyName = fields.company ?? fields.domain ?? "";
  const domain = companyToDomain(fields.domain || fields.company || "");
  return {
    recordType,
    fields,
    first: (fields.first_name ?? "").trim(),
    last: (fields.last_name ?? "").trim(),
    companyName,
    domain,
    resolvedEmail: (fields.email ?? "").trim() || null,
  };
}

/* --------------------------------- helpers ------------------------------- */

function cell(partial: Partial<EnrichCell> & { status: EnrichCell["status"] }, credits: number): EnrichCell {
  return {
    value: null, detail: null, source: null, confidence: null, waterfall: [],
    credits,
    ...partial,
  };
}

const seededChance = (seed: string, p: number) => seededRandom(seed) < p;

/* -------------------------------- runners -------------------------------- */

async function runFindWorkEmail(ctx: RowContext, credits: number): Promise<EnrichCell> {
  if (!ctx.first || !ctx.last || !ctx.domain) {
    return cell({ status: "not_found", detail: "Missing name or company", waterfall: [] }, 0);
  }
  const candidates = buildCandidates(ctx.first, ctx.last, ctx.domain);
  const waterfall: WaterfallStep[] = [];
  const checked: { email: string; label: string; score: number; status: string }[] = [];

  // Try each pattern in priority order until one verifies deliverable. A single
  // pattern failing (rejected mailbox / no MX on that probe) is a per-candidate
  // MISS — we keep going; only when NONE verify do we fall back to a best guess.
  for (const c of candidates) {
    const v = await cachedVerify(c.email);
    checked.push({ email: c.email, label: c.patternLabel, score: v.result.score, status: v.result.status });
    if (v.result.status === "valid") {
      waterfall.push({ source: `Pattern ${c.patternLabel}`, result: "hit" });
      return cell({ status: "found", value: c.email, source: `Pattern ${c.patternLabel}`, confidence: v.result.score, detail: "Verified deliverable", waterfall }, credits);
    }
    waterfall.push({ source: `Pattern ${c.patternLabel}`, result: "miss" });
  }

  // Nothing verified valid — surface the strongest PLAUSIBLE guess. Any verdict
  // that isn't a hard `invalid` (catch-all / risky / unknown) means the address
  // is plausibly deliverable, so we surface it and flag the confidence (Clay
  // shows accept-all emails too). Only a rejected mailbox / dead MX is not found.
  const best = [...checked].sort((a, b) => b.score - a.score)[0];
  if (best && best.status !== "invalid") {
    const detail = best.status === "catch_all" ? "Catch-all (accept-all)" : "Plausible (unverified)";
    return cell({ status: "found", value: best.email, source: `Best pattern ${best.label}`, confidence: best.score, detail, waterfall }, credits);
  }
  return cell({ status: "not_found", detail: "No deliverable mailbox", waterfall }, credits);
}

async function runVerifyEmail(ctx: RowContext, credits: number): Promise<EnrichCell> {
  const email = ctx.resolvedEmail;
  if (!email) return cell({ status: "not_found", detail: "No email to verify" }, 0);
  const v = await cachedVerify(email);
  const verdict = v.result.status;
  const found = verdict === "valid";
  return cell({
    status: found ? "found" : "not_found",
    value: email,
    detail: verdict.replace("_", " "),
    source: "SMTP verify",
    confidence: v.result.score,
    waterfall: [{ source: "SMTP verify", result: found ? "hit" : "miss" }],
  }, credits);
}

function runFindPhone(ctx: RowContext, credits: number): EnrichCell {
  const seed = `${ctx.first}${ctx.last}${ctx.domain}:phone`;
  if (!seededChance(seed, 0.55)) {
    return cell({ status: "not_found", detail: "No number on file", source: "Phone DB", waterfall: [{ source: "Phone DB", result: "miss" }] }, credits);
  }
  const n = (salt: string, min: number, max: number) => min + Math.floor(seededRandom(seed + salt) * (max - min));
  const phone = `+1 ${n("a", 200, 999)} ${n("b", 200, 999)} ${n("c", 1000, 9999)}`;
  return cell({ status: "found", value: phone, source: "Phone DB", confidence: 82, waterfall: [{ source: "Phone DB", result: "hit" }] }, credits);
}

function runFindLinkedin(ctx: RowContext, credits: number): EnrichCell {
  if (ctx.recordType === "companies") {
    if (!ctx.domain) return cell({ status: "not_found", detail: "No domain" }, 0);
    const slug = ctx.domain.split(".")[0];
    return cell({ status: "found", value: `linkedin.com/company/${slug}`, source: "LinkedIn match", confidence: 88, waterfall: [{ source: "LinkedIn match", result: "hit" }] }, credits);
  }
  if (!ctx.first || !ctx.last) return cell({ status: "not_found", detail: "Missing name" }, 0);
  const seed = `${ctx.first}${ctx.last}:li`;
  if (!seededChance(seed, 0.82)) return cell({ status: "not_found", detail: "No profile match", source: "LinkedIn match", waterfall: [{ source: "LinkedIn match", result: "miss" }] }, credits);
  const slug = `${ctx.first}-${ctx.last}`.toLowerCase().replace(/[^a-z-]/g, "");
  return cell({ status: "found", value: `linkedin.com/in/${slug}`, source: "LinkedIn match", confidence: 84, waterfall: [{ source: "LinkedIn match", result: "hit" }] }, credits);
}

function runEnrichCompany(ctx: RowContext, credits: number): EnrichCell {
  if (!ctx.domain) return cell({ status: "not_found", detail: "No company/domain" }, 0);
  const f = firmographics(ctx.domain);
  return cell({
    status: "found",
    value: f.industry,
    detail: `${f.size} employees · ${f.location} · ${f.revenue} · est. ${f.founded}`,
    source: "Company DB",
    confidence: 90,
    waterfall: [{ source: "Company DB", result: "hit" }],
  }, credits);
}

function runCompanyTech(ctx: RowContext, credits: number): EnrichCell {
  if (!ctx.domain) return cell({ status: "not_found", detail: "No domain" }, 0);
  const techs = companyTechnologies(ctx.domain);
  return cell({ status: "found", value: techs.join(" · "), source: "Technographics", confidence: 80, waterfall: [{ source: "Technographics", result: "hit" }] }, credits);
}

function runGenericEmails(ctx: RowContext, credits: number): EnrichCell {
  if (!ctx.domain) return cell({ status: "not_found", detail: "No domain" }, 0);
  const emails = ["support", "info", "sales"].map((t) => `${t}@${ctx.domain}`);
  return cell({ status: "found", value: emails[0], detail: emails.slice(1).join(", "), source: "Role mailboxes", confidence: 70, waterfall: [{ source: "Role mailboxes", result: "hit" }] }, credits);
}

function runAiResearch(ctx: RowContext, credits: number): EnrichCell {
  if (!ctx.domain && !ctx.companyName) return cell({ status: "not_found", detail: "Not enough context" }, 0);
  const name = ctx.companyName || ctx.domain;
  const angles = [
    "Scaling engineering — likely evaluating data tooling.",
    "Recent hiring in GTM — outbound infrastructure is timely.",
    "Cloud-native stack — strong fit for automation tooling.",
    "Growing headcount — onboarding & enablement pain points.",
  ];
  const angle = pick(angles, ctx.domain || name, "angle");
  return cell({
    status: "found",
    value: `${name}: ${angle}`,
    detail: "Outreach angle generated",
    source: "AI",
    confidence: 75,
    waterfall: [{ source: "AI research", result: "hit" }],
  }, credits);
}

/* -------------------------------- dispatch ------------------------------- */

export async function runCell(kind: EnrichColumnKind, ctx: RowContext): Promise<EnrichCell> {
  const credits = columnSpec(kind).costPerRow;
  switch (kind) {
    case "find_work_email": {
      const c = await runFindWorkEmail(ctx, credits);
      if (c.status === "found" && c.value) ctx.resolvedEmail = c.value; // chainable
      return c;
    }
    case "verify_email": return runVerifyEmail(ctx, credits);
    case "find_phone": return runFindPhone(ctx, credits);
    case "find_linkedin": return runFindLinkedin(ctx, credits);
    case "enrich_company": return runEnrichCompany(ctx, credits);
    case "company_tech": return runCompanyTech(ctx, credits);
    case "generic_emails": return runGenericEmails(ctx, credits);
    case "ai_research": return runAiResearch(ctx, credits);
  }
}

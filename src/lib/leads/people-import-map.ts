/**
 * Column auto-mapping for the People import (CSV/XLSX → people seeds).
 * Pure functions so they can be unit-tested outside React.
 */

export const FIRST_RE = /first.?name|given|fname|^first$/i;
export const LAST_RE = /last.?name|surname|family|lname|^last$/i;
export const COMPANY_RE = /^company$|company.?name|organi|account|^business$|employer|^org$/i;
export const CITY_RE = /^city$|town|^locality$/i;
export const STATE_RE = /^state$|province|^region$/i;
export const COUNTRY_RE = /^country$|nation/i;
// Fallback: a single pre-combined location column (no separate city/state/country).
export const LOCATION_RE = /^location$|address|hq/i;
export const FULLNAME_RE = /full.?name|^name$|contact/i;

/**
 * Optional columns that FILL the people table directly from the CSV (an
 * Apollo-style export). Not required — the crawl still runs and fills gaps
 * (esp. a verified email) — but these show immediately. `not` skips a column
 * that also matches a broader pattern (person LinkedIn vs Company Linkedin).
 */
export const OPTIONAL_FIELDS = [
  { key: "title", label: "Title", re: /^title$|job.?title|position|^role$/i },
  { key: "headline", label: "Headline", re: /headline/i },
  { key: "seniority", label: "Seniority", re: /senior/i },
  { key: "department", label: "Department", re: /department/i },
  { key: "personLinkedin", label: "LinkedIn (person)", re: /linked.?in/i, not: /company/i },
  { key: "email", label: "Email", re: /e-?mail/i, not: /domain|catchall|company/i },
  { key: "mobile", label: "Mobile / Phone", re: /mobile|phone|cell|^tel/i, not: /company/i },
  { key: "website", label: "Company Website", re: /company.?website|company.?domain|^website$|^domain$/i },
  { key: "industry", label: "Industry", re: /industry/i },
  { key: "employees", label: "Employees", re: /employees|head.?count|company.?size/i },
  { key: "companyPhone", label: "Company Phone", re: /company.?phone/i },
  { key: "twitter", label: "Twitter", re: /twitter/i, not: /company/i },
  { key: "facebook", label: "Facebook", re: /facebook/i, not: /company/i },
  { key: "photo", label: "Photo", re: /photo|avatar|picture/i },
  // Rich company detail (Apollo-style export). Revenue/Funding match both the
  // raw and "…Clean" columns — bestColumn keeps the denser one.
  { key: "keywords", label: "Keywords", re: /^keywords?$|keyword/i, not: /seo/i },
  { key: "companyLinkedin", label: "Company LinkedIn", re: /company.?linked.?in/i },
  { key: "companyRevenue", label: "Company Annual Revenue", re: /company.?annual.?revenue/i },
  { key: "companyFunding", label: "Company Total Funding", re: /company.?total.?funding/i },
  { key: "companyTechnologies", label: "Company Technologies", re: /company.?technolog|tech.?stack/i },
  { key: "companyFoundedYear", label: "Company Founded Year", re: /company.?founded|founded.?year|year.?founded/i },
  { key: "companySeoDescription", label: "Company SEO Description", re: /seo.?desc/i },
  { key: "companyShortDescription", label: "Company Short Description", re: /short.?desc/i },
] as const satisfies readonly { key: string; label: string; re: RegExp; not?: RegExp }[];

export type OptKey = (typeof OPTIONAL_FIELDS)[number]["key"];
export type Mapping = { firstName: string; lastName: string; company: string; city: string; state: string; country: string } & Record<OptKey, string>;
export const EMPTY_OPT = Object.fromEntries(OPTIONAL_FIELDS.map((f) => [f.key, ""])) as Record<OptKey, string>;

/** How many rows have a value in column `i`. */
export function fillOf(rows: string[][], i: number): number {
  let n = 0;
  for (const r of rows) if ((r[i] ?? "").trim()) n++;
  return n;
}

/**
 * Densest NON-EMPTY column whose header matches `re`; `exclude` skips claimed
 * columns, `not` skips a broader-pattern collision. A column that is blank in
 * every row is never auto-mapped.
 */
export function bestColumn(cols: string[], rows: string[][], re: RegExp, exclude: string[] = [], not?: RegExp): string | undefined {
  let best: string | undefined;
  let bestFill = 0;
  cols.forEach((c, i) => {
    if (exclude.includes(c) || !re.test(c) || (not && not.test(c))) return;
    const fill = fillOf(rows, i);
    if (fill > bestFill) { bestFill = fill; best = c; }
  });
  return best;
}

/** "Person Linkedin Url" → "personlinkedinurl" — for loose header matching. */
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Extra header spellings per field, matched on the normalised header (equals or contains). */
export const ALIASES: Partial<Record<OptKey | "city" | "state" | "country", string[]>> = {
  title: ["jobtitle", "designation", "position", "role", "title"],
  headline: ["headline", "tagline", "bio", "summary"],
  seniority: ["seniority", "level", "senioritylevel"],
  department: ["department", "departments", "function", "team"],
  personLinkedin: ["linkedin", "personlinkedin", "linkedinurl", "linkedinprofile", "profileurl"],
  email: ["email", "emailaddress", "workemail", "businessemail"],
  mobile: ["mobile", "phone", "phonenumber", "mobilephone", "cell", "directphone", "workphone"],
  website: ["website", "domain", "companywebsite", "companydomain", "url", "site"],
  industry: ["industry", "sector", "vertical"],
  employees: ["employees", "headcount", "companysize", "numberofemployees", "employeecount", "size"],
  companyPhone: ["companyphone", "corporatephone", "hqphone", "officephone"],
  twitter: ["twitter", "twitterurl", "x"],
  facebook: ["facebook", "facebookurl"],
  photo: ["photo", "photourl", "avatar", "picture", "image"],
  keywords: ["keywords", "keyword", "tags"],
  companyLinkedin: ["companylinkedin", "companylinkedinurl", "organizationlinkedin"],
  companyRevenue: ["revenue", "annualrevenue", "companyrevenue", "companyannualrevenue"],
  companyFunding: ["funding", "totalfunding", "companyfunding", "companytotalfunding"],
  companyTechnologies: ["technologies", "techstack", "companytechnologies", "technology"],
  companyFoundedYear: ["founded", "foundedyear", "yearfounded", "companyfoundedyear"],
  companySeoDescription: ["seodescription", "companyseodescription"],
  companyShortDescription: ["shortdescription", "companyshortdescription", "description", "companydescription"],
  city: ["city", "town"],
  state: ["state", "province", "region"],
  country: ["country", "nation"],
};

/** Fallback when no regex hit: densest non-empty, unclaimed column whose normalised header equals/contains an alias. */
export function aliasColumn(cols: string[], rows: string[][], aliases: string[] | undefined, exclude: string[]): string | undefined {
  if (!aliases?.length) return undefined;
  let best: string | undefined;
  let bestScore = 0;
  cols.forEach((c, i) => {
    if (exclude.includes(c)) return;
    const n = norm(c);
    const exact = aliases.includes(n);
    const partial = !exact && aliases.some((a) => a.length >= 4 && n.includes(a));
    if (!exact && !partial) return;
    const fill = fillOf(rows, i);
    if (!fill) return;
    const score = fill + (exact ? 1e6 : 0); // exact header beats a partial one
    if (score > bestScore) { bestScore = score; best = c; }
  });
  return best;
}


/** Auto-map every field to the best NON-EMPTY column of the file (regex first, then loose aliases). */
export function autoMap(cols: string[], data: string[][]): Mapping {
  const firstName = bestColumn(cols, data, FIRST_RE) ?? bestColumn(cols, data, FULLNAME_RE) ?? cols.find((_c, i) => fillOf(data, i) > 0) ?? "";
  // Last Name is OPTIONAL — only auto-map a real Last-Name column. Never fall
  // back to "some other column", which used to steal Company/Email into Last
  // Name (emptying the required Company map, so every row looked "missing").
  // A single combined name column is split per-row later (see `built`).
  const lastName = bestColumn(cols, data, LAST_RE, [firstName]) ?? "";
  const company = bestColumn(cols, data, COMPANY_RE, [firstName, lastName].filter(Boolean)) ?? "";
  // Location is composed from City + State + Country (Apollo-style exports).
  // A single generic "Location"/address column falls back into City.
  const base = [firstName, lastName, company];
  const city = bestColumn(cols, data, CITY_RE, base) ?? bestColumn(cols, data, LOCATION_RE, base) ?? aliasColumn(cols, data, ALIASES.city, base) ?? "";
  const state = bestColumn(cols, data, STATE_RE, [...base, city]) ?? aliasColumn(cols, data, ALIASES.state, [...base, city]) ?? "";
  const country = bestColumn(cols, data, COUNTRY_RE, [...base, city, state]) ?? aliasColumn(cols, data, ALIASES.country, [...base, city, state]) ?? "";
  const claimed = [firstName, lastName, company, city, state, country].filter(Boolean);
  const opt = { ...EMPTY_OPT };
  // Pass 1: precise header patterns.
  for (const f of OPTIONAL_FIELDS) {
    const col = bestColumn(cols, data, f.re, claimed, "not" in f ? f.not : undefined);
    if (col) { opt[f.key] = col; claimed.push(col); }
  }
  // Pass 2: loose alias match for anything still unmapped, so every column
  // that holds data lands on a field when there is a sensible one.
  for (const f of OPTIONAL_FIELDS) {
    if (opt[f.key]) continue;
    const col = aliasColumn(cols, data, ALIASES[f.key], claimed);
    if (col) { opt[f.key] = col; claimed.push(col); }
  }
  return { firstName, lastName, company, city, state, country, ...opt };
}

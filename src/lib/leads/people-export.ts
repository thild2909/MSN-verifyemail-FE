/**
 * People → CSV export that round-trips an Apollo-style import.
 *
 * Columns: the imported CSV's own header row when the job has one (so every
 * imported column comes back, in the same order), else the full Apollo people
 * layout below. Each cell is filled from the person's CURRENT data for the
 * fields the app enriches (name, email, LinkedIn, title…), and from the original
 * CSV row for everything else — so nothing imported is dropped.
 */
import { SENIORITY_LABEL, type CollectedPerson } from "./people-types";

/** Apollo people-export layout — the default when a job has no imported header. */
export const APOLLO_PEOPLE_COLUMNS = [
  "First Name", "Last Name", "Company Name", "Company Website", "Email", "Mobile Number", "Personal Email", "Full Name",
  "LinkedIn", "Title", "Industry", "Headline", "Seniority", "Department", "City", "State", "Country", "Employees Count",
  "Keywords", "Company Annual Revenue Clean", "Company Annual Revenue", "Company SEO Description", "Company Short Description",
  "Company Linkedin", "Company Linkedin UID", "Company Total Funding Clean", "Company Total Funding", "Company Technologies",
  "Email Domain Catchall", "Person Photo", "Twitter URL", "Facebook URL", "Person ID", "Company ID", "Company Phone Number",
  "Company Logo", "Company Twitter", "Company Facebook", "Company Market Cap", "Company Founded Year", "Company Domain",
  "Company Raw Address", "Company Street Address", "Company City", "Company State", "Company Country", "Company Postal Code",
];

/**
 * City / State / Country. Uses the separately-stored fields when the person
 * carries them; otherwise best-effort splits the combined `location`
 * ("City, State, Country" — some parts may be missing): 1 part → city; 2 →
 * city + country; 3+ → city + state + country.
 */
function splitLocation(p: CollectedPerson): { city: string; state: string; country: string } {
  if (p.city || p.state || p.country) return { city: p.city ?? "", state: p.state ?? "", country: p.country ?? "" };
  const parts = (p.location ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { city: "", state: "", country: "" };
  if (parts.length === 1) return { city: parts[0], state: "", country: "" };
  if (parts.length === 2) return { city: parts[0], state: "", country: parts[1] };
  return { city: parts[0], state: parts.slice(1, -1).join(", "), country: parts[parts.length - 1] };
}

const url = (v?: string | null) => (!v ? "" : /^https?:\/\//i.test(v) ? v : `http://${v}`);
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

type Getter = (p: CollectedPerson) => string;
/**
 * `person` — the app's value wins (it may have been enriched/corrected), the
 *            CSV cell is the fallback.
 * `source` — the CSV cell wins; the app's value only fills a blank (used where
 *            the app keeps one merged value for several CSV columns, e.g.
 *            revenue raw vs "Clean").
 */
const FIELDS: Record<string, { get: Getter; prefer: "person" | "source" }> = {};
const def = (headers: string[], prefer: "person" | "source", get: Getter) => { for (const h of headers) FIELDS[norm(h)] = { get, prefer }; };

def(["First Name"], "person", (p) => p.firstName);
def(["Last Name"], "person", (p) => p.lastName);
def(["Full Name", "Name"], "person", (p) => p.name);
def(["Company Name", "Company"], "person", (p) => p.company);
def(["Company Website", "Website"], "source", (p) => url(p.companyDomain));
def(["Company Domain", "Domain"], "source", (p) => str(p.companyDomain));
def(["Email"], "person", (p) => str(p.email?.value));
def(["Mobile Number", "Mobile", "Phone"], "person", (p) => str(p.mobile));
def(["LinkedIn", "LinkedIn URL", "Person Linkedin Url"], "person", (p) => url(p.linkedin?.value ? String(p.linkedin.value) : ""));
def(["Title", "Job Title"], "person", (p) => str(p.title?.value));
def(["Industry"], "person", (p) => str(p.companyIndustry));
def(["Headline"], "person", (p) => str(p.headline));
def(["Seniority"], "source", (p) => SENIORITY_LABEL[p.seniority] ?? "");
def(["Department"], "person", (p) => str(p.department));
def(["City"], "person", (p) => splitLocation(p).city);
def(["State"], "person", (p) => splitLocation(p).state);
def(["Country"], "person", (p) => splitLocation(p).country);
def(["Location"], "person", (p) => str(p.location));
def(["Employees Count", "Employees"], "person", (p) => str(p.companyEmployees));
def(["Keywords"], "person", (p) => str(p.keywords));
def(["Company Annual Revenue Clean", "Company Annual Revenue"], "source", (p) => str(p.companyRevenue));
def(["Company Total Funding Clean", "Company Total Funding"], "source", (p) => str(p.companyFunding));
def(["Company SEO Description"], "person", (p) => str(p.companySeoDescription));
def(["Company Short Description"], "person", (p) => str(p.companyShortDescription));
def(["Company Linkedin"], "person", (p) => url(p.companyLinkedin));
def(["Company Technologies"], "person", (p) => str(p.companyTechnologies));
def(["Person Photo", "Photo"], "person", (p) => str(p.photo));
def(["Twitter URL", "Twitter"], "person", (p) => str(p.twitter));
def(["Facebook URL", "Facebook"], "person", (p) => str(p.facebook));
def(["Company Phone Number", "Company Phone"], "person", (p) => str(p.companyPhone));
def(["Company Email"], "person", (p) => str(p.companyEmail));
def(["Company Founded Year"], "person", (p) => str(p.companyFoundedYear));

/**
 * Headers + rows for a people export. `sourceColumns` is the job's imported
 * header (People tab). Without it (e.g. a saved list mixing several imports) the
 * columns are the union of each person's own `sourceColumns`, first-seen order,
 * falling back to the Apollo layout when nobody carries an imported header.
 */
export function peopleExportTable(people: CollectedPerson[], sourceColumns?: string[] | null): { headers: string[]; rows: string[][] } {
  let headers = sourceColumns?.length ? sourceColumns : null;
  if (!headers) {
    const seen = new Set<string>();
    const union: string[] = [];
    for (const p of people) for (const h of p.sourceColumns ?? []) if (!seen.has(h)) { seen.add(h); union.push(h); }
    headers = union.length ? union : APOLLO_PEOPLE_COLUMNS;
  }
  const fields = headers.map((h) => FIELDS[norm(h)]);
  const rows = people.map((p) => {
    // The person's CSV cells, keyed by its own header (another import may order
    // columns differently). A crawled person has none.
    const own = p.sourceColumns?.length ? p.sourceColumns : sourceColumns;
    const src = new Map<string, string>();
    if (own?.length && p.sourceRow?.length === own.length) own.forEach((h, i) => { if (!src.has(h)) src.set(h, p.sourceRow![i]); });
    return headers.map((h, i) => {
      const csv = str(src.get(h));
      const f = fields[i];
      if (!f) return csv;
      const mine = f.get(p);
      return f.prefer === "person" ? mine || csv : csv || mine;
    });
  });
  return { headers, rows };
}

/**
 * Find Leads — lightweight natural-language search parser.
 *
 * Converts a free-text prospecting query ("CTOs at fintech companies in
 * Australia, 50-200 employees") into recognised filter chips + a People filter
 * patch, powering the "AI understood your search as" panel. Rule-based and
 * deterministic — no model call.
 */
import {
  COUNTRIES, INDUSTRIES, TECHNOLOGIES, EMPLOYEE_BANDS,
  type EmployeeBand, type Industry, type PeopleFilters,
} from "./types";

export interface ParsedChip {
  field: string;
  label: string;
}

export interface ParsedQuery {
  chips: ParsedChip[];
  patch: Partial<PeopleFilters>;
}

const TITLE_TERMS: { re: RegExp; label: string }[] = [
  { re: /\bcto\b/i, label: "CTO" },
  { re: /\bcio\b/i, label: "CIO" },
  { re: /\bceo\b/i, label: "CEO" },
  { re: /founders?\b/i, label: "Founder" },
  { re: /\bvp\b|vice president/i, label: "VP of Engineering" },
  { re: /head of (engineering|technology|ai)/i, label: "Head of" },
  { re: /(ai|machine learning|ml) (engineer|leaders?)/i, label: "AI Engineer" },
  { re: /engineering (manager|leaders?)/i, label: "Engineering Manager" },
  { re: /data engineer/i, label: "Data Engineer" },
];

/** Map an employee-count range onto the fixed bands it overlaps. */
function bandsForRange(min: number, max: number): EmployeeBand[] {
  const ranges: Record<EmployeeBand, [number, number]> = {
    "1-10": [1, 10], "11-50": [11, 50], "51-200": [51, 200], "201-500": [201, 500],
    "501-1000": [501, 1000], "1001-5000": [1001, 5000], "5001+": [5001, 1_000_000],
  };
  return EMPLOYEE_BANDS.filter((b) => {
    const [lo, hi] = ranges[b];
    return lo <= max && hi >= min;
  });
}

export function parseNaturalQuery(query: string): ParsedQuery {
  const q = query.trim();
  const chips: ParsedChip[] = [];
  const patch: Partial<PeopleFilters> = {};
  if (!q) return { chips, patch };

  // Job titles
  const titles: string[] = [];
  for (const t of TITLE_TERMS) {
    if (t.re.test(q) && !titles.includes(t.label)) {
      titles.push(t.label);
      chips.push({ field: "Job title", label: t.label });
    }
  }
  if (titles.length) patch.jobTitles = titles;

  // Industry
  const industries: Industry[] = [];
  for (const ind of INDUSTRIES) {
    if (new RegExp(`\\b${ind.replace(/[^a-z]/gi, "")}\\b`, "i").test(q.replace(/[^a-z0-9 ]/gi, ""))) {
      industries.push(ind);
      chips.push({ field: "Industry", label: ind });
    }
  }
  if (industries.length) patch.industries = industries;

  // Country
  for (const c of COUNTRIES) {
    const alias = c === "United States" ? /(united states|usa|u\.s\.|america)/i : c === "United Kingdom" ? /(united kingdom|uk|u\.k\.|britain|england)/i : new RegExp(c, "i");
    if (alias.test(q)) {
      patch.country = c;
      chips.push({ field: "Location", label: c });
      break;
    }
  }

  // Technologies
  const techs: string[] = [];
  for (const tech of TECHNOLOGIES) {
    if (new RegExp(`\\b${tech.replace(/[.+]/g, "\\$&")}\\b`, "i").test(q)) {
      techs.push(tech);
      chips.push({ field: "Technology", label: tech });
    }
  }
  if (techs.length) patch.technologies = techs;

  // Employee-count range: "50-200", "20 to 100", "50–200 employees"
  const range = q.match(/(\d[\d,]*)\s*(?:-|–|to)\s*(\d[\d,]*)/);
  if (range) {
    const min = Number(range[1].replace(/,/g, ""));
    const max = Number(range[2].replace(/,/g, ""));
    const bands = bandsForRange(min, max);
    if (bands.length) {
      patch.companySize = bands;
      chips.push({ field: "Company size", label: `${min}–${max}` });
    }
  }

  return { chips, patch };
}

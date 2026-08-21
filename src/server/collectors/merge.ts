/**
 * Merge layer. Sources are collected in priority order (real before simulated);
 * for each field the first source that supplies it wins the value, and every
 * later source that supplies the SAME normalized value raises that field's
 * confidence and increments its `agreement` count — the "two sources agree ⇒
 * higher confidence" rule from the spec. Source attribution is preserved.
 */
import "server-only";
import type { CollectedCompany, SourcedField } from "@/lib/leads/collect-types";

// Field keys carrying a SourcedField on CollectedCompany.
const FIELD_KEYS = [
  "website", "emailDomain", "contactEmail", "phone", "linkedin", "twitter", "facebook",
  "address", "mapsRating", "industry", "employees", "revenue", "founded", "description",
  "technologies", "legalName", "jurisdiction", "registrationNumber", "incorporated",
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

function norm(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x).toLowerCase()).sort().join(",");
  return String(v).toLowerCase().replace(/\s+/g, " ").trim();
}

/** Merge field candidates from sources (already in priority order). */
export function mergeFields(sources: Partial<CollectedCompany>[]): Partial<CollectedCompany> {
  const out: Partial<CollectedCompany> = {};
  for (const key of FIELD_KEYS) {
    let winner: SourcedField<unknown> | null = null;
    let agreement = 0;
    for (const src of sources) {
      const f = src[key] as SourcedField<unknown> | null | undefined;
      if (!f) continue;
      if (!winner) { winner = { ...f }; agreement = 1; continue; }
      if (norm(f.value) === norm(winner.value)) agreement++;
    }
    if (winner) {
      if (agreement > 1) {
        winner.agreement = agreement;
        winner.confidence = Math.min(99, winner.confidence + (agreement - 1) * 4);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (out as any)[key] = winner;
    }
  }
  return out;
}

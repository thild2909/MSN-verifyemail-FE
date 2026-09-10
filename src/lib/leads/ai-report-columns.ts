/** A report column returned by the AI report endpoint (dynamic per prompt). */
export interface AiReportColumn { key: string; label: string }

/**
 * Per-column width hints for the known base columns. Dynamic/extra columns (added
 * when the prompt requests extra output fields) fall back to a sensible default.
 */
const WIDTH_BY_KEY: Record<string, string> = {
  rank: "w-12",
  company: "min-w-44",
  country: "w-16",
  website: "min-w-32",
  type: "min-w-52",
  employees: "w-28",
  role: "min-w-44",
  location: "min-w-28",
  posted: "w-24",
  jobSource: "min-w-32",
  signal: "min-w-56",
  msnFit: "min-w-56",
  verificationNotes: "min-w-56",
  // common extras
  recipient: "min-w-36",
  title: "min-w-36",
  email: "min-w-36",
  recipientSource: "min-w-36",
  subject: "min-w-64",
  draftStatus: "w-28",
  draftId: "min-w-36",
};

export function columnWidth(key: string): string {
  return WIDTH_BY_KEY[key] ?? "min-w-40";
}

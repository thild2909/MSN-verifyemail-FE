/**
 * Live smoke test for the Layer-5 server path (BE /llm/name-email-structure).
 *
 * The pure suite (finder-regression) covers the deterministic engine + all the
 * decision helpers; this covers the ONE part that can't be mocked — the LLM
 * verify→discover→analyze step — end to end against the running crawler service.
 * It costs a few LLM calls, so it is OPT-IN (not part of `test:finder`):
 *
 *   npm run test:l5-live            (needs BE up on :8090 + OpenAI configured)
 *
 * Assertions are LOOSE (presence of the key domain/name token, not an exact list)
 * so normal LLM variance doesn't cause false failures; a miss on these means the
 * M&A / slug / short-form coverage genuinely regressed.
 */
const BASE = process.env.CRAWLER_SERVICE_URL ?? "http://localhost:8090";
let failures = 0;
const fail = (m) => { failures++; console.error("  ✗ " + m); };
const ok = (m) => console.log("  ✓ " + m);

async function l5(record, webSearch) {
  const res = await fetch(`${BASE}/llm/name-email-structure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ webSearch, records: [record] }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const d = await res.json();
  return { configured: d.configured, r: d.results?.[0], tokens: d.tokens, model: d.model };
}

const CASES = [
  {
    label: "M&A parent domain (Camms → Riskonnect)",
    web: true,
    rec: { id: "1", name: "Dakshitha Gunasekera", country: "Sri Lanka", title: "Head of Product", company: "Camms", linkedin: "www.linkedin.com/in/dakshitha-gunasekera", domain: "cammsgroup.com", companyEmail: "cammscollege@cammsgroup.com" },
    check: (r) => (r.domains ?? []).some((d) => /riskonnect\.com/i.test(d)) || /riskonnect/i.test(JSON.stringify(r)),
    want: "riskonnect.com in domains",
  },
  {
    label: "Concatenated slug + wrong surname (Katrina → Narag)",
    web: true,
    rec: { id: "1", name: "Katrina Landicho", country: "Philippines", title: "Product Owner", company: "Siteminder", linkedin: "www.linkedin.com/in/katrinamichnarag", domain: "siteminder.com", companyEmail: "support@siteminder.com" },
    check: (r) => /narag/i.test(r.correctName ?? "") && (r.locals ?? []).some((l) => /narag/i.test(l)),
    want: "correctName + a local contain 'narag'",
  },
  {
    label: "Given short form (Rajendra → raj)",
    web: false,
    rec: { id: "1", name: "Rajendra Zore", country: "Malaysia", title: "CMO", company: "RunCloud", domain: "runcloud.io" },
    check: (r) => (r.locals ?? []).includes("raj"),
    want: "'raj' in locals",
  },
  {
    label: "Family short form (Ahmad Fikrizaman → fikri)",
    web: false,
    rec: { id: "1", name: "Ahmad Fikrizaman", country: "Malaysia", title: "CTO", company: "RunCloud", domain: "runcloud.io", companyEmail: "support@runcloud.io" },
    check: (r) => (r.locals ?? []).includes("fikri"),
    want: "'fikri' in locals",
  },
  {
    label: "No false M&A (RunCloud stays runcloud.io)",
    web: true,
    rec: { id: "1", name: "Ahmad Fikrizaman", country: "Malaysia", title: "CTO", company: "RunCloud", domain: "runcloud.io", companyEmail: "support@runcloud.io" },
    check: (r) => (r.domains ?? []).every((d) => /runcloud\.io/i.test(d)) && (r.domains ?? []).length > 0,
    want: "domains stay runcloud.io (no hallucinated parent)",
  },
];

console.log(`\n== Layer-5 live smoke (${BASE}) ==`);
try {
  const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) { console.error("BE not reachable — start it first."); process.exit(2); }
} catch { console.error("BE not reachable — start it first."); process.exit(2); }

for (const c of CASES) {
  try {
    const { configured, r, tokens, model } = await l5(c.rec, c.web);
    if (!configured) { console.error("  ! LLM not configured — skipping the rest"); process.exit(2); }
    if (r && c.check(r)) ok(`${c.label} — ${c.want} [${model}, ${tokens} tok]`);
    else fail(`${c.label} — expected ${c.want}, got ${JSON.stringify(r)}`);
  } catch (e) {
    fail(`${c.label} — request error ${e instanceof Error ? e.message : e}`);
  }
}

console.log(`\n${failures === 0 ? "ALL PASS ✅" : `${failures} FAILURE(S) ❌`}`);
process.exit(failures === 0 ? 0 : 1);

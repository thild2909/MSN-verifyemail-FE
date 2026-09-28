/**
 * Regression guard for the culture-aware email-pattern engine (Layer 4) and the
 * LinkedIn-slug name recovery. Every case we have ever fixed is codified here so
 * a change that covers a NEW case can never silently break an OLD one.
 *
 * Run:  npx tsx scripts/finder-regression.mjs        (from MSN-FE/)
 * Exits non-zero if any assertion fails. Pure module only — no server / no LLM,
 * so it is fast and deterministic. (LLM-only cases — M&A parent domain, semantic
 * concatenated-slug splitting — are validated separately against a live backend.)
 */
import {
  generateGlobalCandidates,
  bestFullName,
  nameFromLinkedinSlug,
  detectProfile,
  splitFirstLast,
  mergeLocals,
  orderedTokensFromConcatSlug,
} from "../src/lib/finder/global-name-patterns.ts";
import { layerContinues, webEscalationTargets, escalateL5, titleResolvableForReverseLookup, isDistinctiveLocal, verifyRanked, partitionByDomain, registrableDomain, sameCompanyDomain, scrapedEmailTrusted, emailFormatTemplate, companyMailDomainHint } from "../src/lib/finder/verify-orchestration.ts";
import { smtpTransientError } from "../src/lib/verifier/reacher.ts";
import { companyDomainVariants, strongVariantMatch, variantPageRelevant } from "../src/lib/finder/domain-variants.ts";
import { extractSiteMailDomains } from "../src/lib/finder/site-mail-domains.ts";

const LIMIT = 20; // the verified window Layer 4 actually SMTP-checks
let failures = 0;
const fail = (msg) => { failures++; console.error("  ✗ " + msg); };
const ok = (msg) => console.log("  ✓ " + msg);

/** Locals Layer 4 would generate, mirroring the real flow (slug-recovered name). */
function locals(name, country, linkedin) {
  const eff = bestFullName(name, linkedin);
  return generateGlobalCandidates(eff, { country, linkedin, limit: LIMIT }).map((c) => c.local);
}

/**
 * A case: `expect` locals MUST all appear in the top-LIMIT window; `forbid`
 * substrings/locals MUST NOT appear (precision guards).
 */
const CASES = [
  { label: "Western full", n: "John Michael Smith", c: "US", expect: ["john.smith", "johnsmith", "jsmith", "john"] },
  { label: "Vietnamese given-last", n: "Nguyen Hoai Duc", c: "Vietnam", expect: ["ducnh", "duc.nguyen", "duc", "nguyen.duc"] },
  { label: "Chinese family-first", n: "Wang Wei", c: "China", expect: ["wang.wei", "wangwei", "wwei"] },
  { label: "Chinese compound given", n: "Chen Wei Ming", c: "Taiwan", expect: ["chen.wei", "chen.weiming"] },
  { label: "Malay 2nd-name + short", n: "Ahmad Fikrizaman", c: "Malaysia", expect: ["ahmad.fikrizaman", "ahmadfikrizaman", "ahmad", "fikri"] },
  { label: "Malay patronymic (bin)", n: "Ahmad Hakim bin Abdullah", c: "Malaysia", expect: ["ahmad.hakim", "ahmad"], forbid: ["abdullah"] },
  { label: "Hispanic double surname", n: "Juan Carlos García López", c: "Spain", expect: ["juan.garcia", "jgarcia"] },
  { label: "Germanic umlaut fold", n: "Jörg Müller", c: "Germany", expect: ["joerg.mueller", "jmueller"], forbid: ["jorg", "muller@"] },
  { label: "French hyphenated given", n: "Jean-Pierre Martin", c: "France", expect: ["jean-pierre.martin", "jeanpierre.martin"] },
  { label: "Dutch surname particle", n: "Jan van der Berg", c: "Netherlands", expect: ["jan.vanderberg", "jvanderberg"] },
  { label: "Korean family-first", n: "Kim Min-su", c: "South Korea", expect: ["kim.minsu", "kminsu"] },
  { label: "Arabic prefix glued", n: "Mohammed Ahmed Al-Hassan", c: "UAE", expect: ["mohammed.alhassan", "malhassan"] },
  { label: "Indonesian single name", n: "Suharto", c: "Indonesia", expect: ["suharto"], forbidRe: /\./ /* no fabricated dotted local */ },
  { label: "SG Chinese (routed)", n: "Tan Wei Ming", c: "Singapore", expect: ["tan.wei", "tan.weiming"] },
  { label: "Given short form (raj)", n: "Rajendra Zore", c: "Malaysia", expect: ["rajendra.zore", "raj"] },
  { label: "Initials (cp)", n: "Christopher Plowman", c: "Australia", expect: ["christopher.plowman", "cplowman", "cp"] },
  { label: "Slug recovery + compound", n: "Lecelyn Bueno", c: "Philippines", linkedin: "www.linkedin.com/in/kim-lecelyn-bueno", expect: ["kimlecelyn.bueno", "kim.bueno"] },
  // Concatenated CJK-Malaysian slug: "Yew Kang" + slug kangyewjin → "Kang Yew Jin"
  // → yewjin.kang (full-given.family). bestFullName is applied in `locals()`.
  { label: "Concat CJK slug (Kang Yew Jin)", n: "Yew Kang", c: "Malaysia", linkedin: "www.linkedin.com/in/kangyewjin", expect: ["yewjin.kang", "kang.yewjin"] },
];

console.log("\n== Layer 4 candidate coverage ==");
for (const t of CASES) {
  const got = locals(t.n, t.c, t.linkedin);
  const set = new Set(got);
  const missing = (t.expect ?? []).filter((e) => !set.has(e));
  const present = (t.forbid ?? []).filter((f) => got.some((g) => g === f || g.includes(f.replace(/@$/, ""))));
  const reHit = t.forbidRe ? got.filter((g) => t.forbidRe.test(g)) : [];
  if (missing.length === 0 && present.length === 0 && reHit.length === 0) {
    ok(`${t.label}: [${(t.expect ?? []).join(", ")}]`);
  } else {
    if (missing.length) fail(`${t.label}: MISSING ${missing.join(", ")} — got: ${got.slice(0, 12).join(" ")}`);
    if (present.length) fail(`${t.label}: FORBIDDEN present ${present.join(", ")}`);
    if (reHit.length) fail(`${t.label}: forbidden pattern hit ${reHit.join(", ")}`);
  }
}

console.log("\n== Profile detection ==");
const PROFILES = [
  ["US", "western"], ["Vietnam", "vietnamese"], ["China", "chinese"], ["Malaysia", "sea_malay"],
  ["Philippines", "western"], ["Germany", "germanic"], ["Spain", "hispanic"], ["Sri Lanka", "south_asian"],
  ["Metro Manila, Philippines", "western"], ["Cyberjaya, Selangor, Malaysia", "sea_malay"],
];
for (const [loc, want] of PROFILES) {
  const got = detectProfile(loc, "");
  got === want ? ok(`${loc} → ${got}`) : fail(`${loc} → ${got} (want ${want})`);
}

console.log("\n== LinkedIn slug recovery ==");
const SLUGS = [
  ["www.linkedin.com/in/kim-lecelyn-bueno", "Kim Lecelyn Bueno"],
  ["linkedin.com/in/dakshitha-gunasekera", "Dakshitha Gunasekera"],
  ["linkedin.com/in/john-smith-9b3f2a1", "John Smith"], // trailing id stripped
  ["linkedin.com/in/christoplowman", null], // single concatenated token → null (leave to L5)
  ["linkedin.com/in/rauchg", null],
];
for (const [url, want] of SLUGS) {
  const got = nameFromLinkedinSlug(url);
  got === want ? ok(`${url} → ${JSON.stringify(got)}`) : fail(`${url} → ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
}

console.log("\n== bestFullName (superset guard) ==");
const BEST = [
  ["Lecelyn Bueno", "www.linkedin.com/in/kim-lecelyn-bueno", "Kim Lecelyn Bueno"], // slug adds first token
  ["Guillermo Rauch", "linkedin.com/in/rauchg", "Guillermo Rauch"], // unusable slug → keep
  ["Some Other", "www.linkedin.com/in/kim-lecelyn-bueno", "Some Other"], // unrelated slug → keep stored
  ["Kim Lecelyn Bueno", "www.linkedin.com/in/kim-lecelyn-bueno", "Kim Lecelyn Bueno"], // equal → keep
  // Vanity filler is not a name (real mailbox benwong@riverchain.com, not the.wong@).
  ["Ben Wong", "www.linkedin.com/in/thebenwong", "Ben Wong"],
  ["Jane Lee", "www.linkedin.com/in/dr-jane-lee", "Jane Lee"],
  ["John Tan", "www.linkedin.com/in/iamjohntan", "John Tan"],
  ["Se Song", "www.linkedin.com/in/se-han-song-94445818", "Se Han Song"], // real extra token still recovered
  ["Yew Kang", "www.linkedin.com/in/kangyewjin", "Kang Yew Jin"], // concat recovery unchanged
];
for (const [name, url, want] of BEST) {
  const got = bestFullName(name, url);
  got === want ? ok(`("${name}", slug) → "${got}"`) : fail(`("${name}", slug) → "${got}" (want "${want}")`);
}

console.log("\n== orderedTokensFromConcatSlug (recover missing token) ==");
{
  const seg = orderedTokensFromConcatSlug("kangyewjin", ["yew", "kang"]);
  JSON.stringify(seg) === JSON.stringify(["kang", "yew", "jin"]) ? ok(`kangyewjin+[yew,kang] → ${JSON.stringify(seg)}`) : fail(`→ ${JSON.stringify(seg)}`);
  // stored tokens must TILE the slug — an unrelated slug returns null (no guess).
  orderedTokensFromConcatSlug("kangyewjin", ["some", "person"]) === null ? ok("unrelated stored → null") : fail("unrelated stored not null");
  // no new token discovered → null (don't just re-split the stored name).
  orderedTokensFromConcatSlug("yewkang", ["yew", "kang"]) === null ? ok("no new token → null") : fail("no-new-token not null");
}

console.log("\n== splitFirstLast (Layer 1 slug-recovered split) ==");
const SPLITS = [
  ["Kim Lecelyn Bueno", { first: "Kim", last: "Bueno" }],
  ["John Smith", { first: "John", last: "Smith" }],
  ["Suharto", null],
];
for (const [name, want] of SPLITS) {
  const got = splitFirstLast(name);
  JSON.stringify(got) === JSON.stringify(want) ? ok(`"${name}" → ${JSON.stringify(got)}`) : fail(`"${name}" → ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
}

console.log("\n== mergeLocals (L5 locals ∪ generator) ==");
{
  // The LLM proposed a couple of locals for a discovered parent domain; the merge
  // must ADD the deterministic breadth (initials/short/order) without dropping the
  // LLM ones, and keep LLM locals first.
  const merged = mergeLocals(["dakshitha.gunasekera", "dgunasekera"], "Dakshitha Gunasekera", { country: "Sri Lanka", limit: 14 });
  const need = ["dakshitha.gunasekera", "dgunasekera", "dg"]; // dg = initials from generator
  const miss = need.filter((x) => !merged.includes(x));
  merged[0] === "dakshitha.gunasekera" && miss.length === 0
    ? ok(`merge → ${merged.slice(0, 6).join(" ")} …`)
    : fail(`merge missing ${miss.join(", ")} or wrong order → ${merged.join(" ")}`);
}

console.log("\n== Layer sequencing (layerContinues) ==");
for (const [state, want] of [["not_found", true], ["no_mx", true], ["verified", false], ["accept_all", false]]) {
  layerContinues(state) === want ? ok(`${state} → ${want}`) : fail(`${state} → ${layerContinues(state)} (want ${want})`);
}

console.log("\n== titleResolvableForReverseLookup (L3 gate #4) ==");
const TITLES = [
  ["Chief Executive Officer", true], ["CTO", true], ["Founder", true], ["Co-Founder", true],
  ["VP of Engineering", true], ["Head of Product", true], ["Managing Director", true], ["Owner", true],
  ["Product Owner", false], ["Project Owner - PH Payments", false], ["Data Owner", false],
  ["Software Engineer", false], ["Analyst", false], ["", false], [null, false],
];
for (const [title, want] of TITLES) {
  titleResolvableForReverseLookup(title) === want ? ok(`${JSON.stringify(title)} → ${want}`) : fail(`${JSON.stringify(title)} → ${titleResolvableForReverseLookup(title)} (want ${want})`);
}

console.log("\n== isDistinctiveLocal (#2 domain-less precision guard) ==");
for (const [local, want] of [
  ["john.smith", true], ["kimlecelyn.bueno", true], ["johnsmith", true], ["dakshitha", true],
  ["cp", false], ["raj", false], ["fikr", false], ["jd", false], ["kim", false],
]) {
  isDistinctiveLocal(local) === want ? ok(`${local} → ${want}`) : fail(`${local} → ${isDistinctiveLocal(local)} (want ${want})`);
}

console.log("\n== webEscalationTargets (cap + no-demote of same-domain M&A) ==");
{
  const misses = [
    { id: "camms", domain: "cammsgroup.com", companyEmail: "x@cammsgroup.com" }, // same domain (Camms-type M&A)
    { id: "nodom", domain: null, companyEmail: null }, // no website → promoted
    { id: "brand", domain: "site.com", companyEmail: "x@parent.com" }, // diff domain
  ];
  const capAll = webEscalationTargets(misses, 10).map((t) => t.id);
  // no-domain first; the rest keep FIFO; Camms is NOT dropped/demoted below brand.
  const okOrder = capAll[0] === "nodom" && capAll.includes("camms") && capAll.includes("brand");
  okOrder ? ok(`priority → ${capAll.join(", ")}`) : fail(`priority → ${capAll.join(", ")}`);
  const capped = webEscalationTargets(misses, 2).map((t) => t.id);
  capped.length === 2 && capped[0] === "nodom" ? ok(`cap=2 → ${capped.join(", ")}`) : fail(`cap=2 → ${capped.join(", ")}`);
  webEscalationTargets(misses, 0).length === 0 ? ok("cap=0 → []") : fail("cap=0 not empty");
}

console.log("\n== escalateL5 (demand-driven web escalation) ==");
{
  const R = (valid) => ({ valid, tag: valid ? "hit" : "miss" });
  const mk = (ids, valid) => new Map(ids.map((id) => [id, R(valid)]));
  const idOf = (t) => t.id;

  // A: knowledge resolves all → web NOT called.
  {
    let webCalled = false;
    const r = await escalateL5([{ id: "a" }], {
      idOf, knowledge: async () => mk(["a"], true), web: async () => { webCalled = true; return new Map(); },
      escalate: true, cap: 10, notFound: () => R(false),
    });
    !webCalled && r.get("a").valid ? ok("all-valid → no web") : fail(`all-valid webCalled=${webCalled}`);
  }
  // B: knowledge miss → web called with the miss; web valid wins.
  {
    let webWith = null;
    const r = await escalateL5([{ id: "a", domain: "x.com" }], {
      idOf, knowledge: async () => mk(["a"], false), web: async (ts) => { webWith = ts.map(idOf); return mk(["a"], true); },
      escalate: true, cap: 10, notFound: () => R(false),
    });
    JSON.stringify(webWith) === JSON.stringify(["a"]) && r.get("a").valid ? ok("miss → web escalates & wins") : fail(`miss escalation webWith=${JSON.stringify(webWith)}`);
  }
  // C: escalate=false → web never called, miss stays.
  {
    let webCalled = false;
    const r = await escalateL5([{ id: "a" }], {
      idOf, knowledge: async () => mk(["a"], false), web: async () => { webCalled = true; return new Map(); },
      escalate: false, cap: 10, notFound: () => R(false),
    });
    !webCalled && !r.get("a").valid ? ok("escalate=false → no web") : fail(`escalate=false webCalled=${webCalled}`);
  }
  // D: cap limits how many misses escalate.
  {
    let webCount = 0;
    await escalateL5([{ id: "a", domain: "x.com" }, { id: "b", domain: "y.com" }, { id: "c", domain: "z.com" }], {
      idOf, knowledge: async () => mk(["a", "b", "c"], false), web: async (ts) => { webCount = ts.length; return new Map(); },
      escalate: true, cap: 2, notFound: () => R(false),
    });
    webCount === 2 ? ok("cap=2 → web sees 2 of 3 misses") : fail(`cap=2 → web saw ${webCount}`);
  }
}

console.log("\n== scraped-email domain guard (namesake reject) ==");
{
  const rd = [["a@uwf.edu", "uwf.edu"], ["x@mail.cukrudev.com", "cukrudev.com"], ["y@corp.co.uk", "corp.co.uk"], ["z@a.b.co.uk", "b.co.uk"]];
  for (const [inp, want] of rd) {
    registrableDomain(inp) === want ? ok(`registrable ${inp} → ${want}`) : fail(`registrable ${inp} → ${registrableDomain(inp)} (want ${want})`);
  }
  sameCompanyDomain("mrashid@mail.cukrudev.com", "cukrudev.com") ? ok("same-company subdomain") : fail("same-company subdomain");
  !sameCompanyDomain("mrashid@uwf.edu", "cukrudev.com") ? ok("uwf.edu ≠ cukrudev.com") : fail("uwf.edu wrongly matched");
  // the reported bug: reject the namesake on the unrelated domain.
  !scrapedEmailTrusted("mrashid@uwf.edu", "cukrudev.com", "Muhammad", "Rashid") ? ok("REJECT mrashid@uwf.edu (namesake)") : fail("mrashid@uwf.edu wrongly trusted");
  scrapedEmailTrusted("m.rashid@cukrudev.com", "cukrudev.com", "Muhammad", "Rashid") ? ok("trust on company domain") : fail("company-domain email rejected");
  scrapedEmailTrusted("muhammadrashid@gmail.com", "cukrudev.com", "Muhammad", "Rashid") ? ok("trust free-mail w/ full name") : fail("free+strong rejected");
  !scrapedEmailTrusted("mrashid@gmail.com", "cukrudev.com", "Muhammad", "Rashid") ? ok("REJECT free-mail w/o full name") : fail("weak free-mail wrongly trusted");
}

console.log("\n== partitionByDomain (two-round scheduling) ==");
{
  const rows = [
    { id: "a1", d: "acme.com" }, { id: "a2", d: "acme.com" }, { id: "a3", d: "acme.com" },
    { id: "b1", d: "beta.com" }, { id: "n1", d: "" }, { id: "n2", d: "" }, { id: "b2", d: "beta.com" },
  ];
  const { probes, rest } = partitionByDomain(rows, (r) => r.d);
  const p = probes.map((r) => r.id).join(",");
  const rr = rest.map((r) => r.id).join(",");
  // one probe per domain (first seen); everyone else + no-domain rows → rest.
  p === "a1,b1" && rr === "a2,a3,n1,n2,b2" ? ok(`probes=[${p}] rest=[${rr}]`) : fail(`probes=[${p}] rest=[${rr}]`);
  const total = probes.length + rest.length;
  total === rows.length ? ok("no row lost/duplicated") : fail(`total ${total} != ${rows.length}`);

  // probeScore: pick the highest-scoring row per domain as the probe.
  const scored = [
    { id: "a1", d: "acme.com", s: 0 }, { id: "a2", d: "acme.com", s: 3 }, { id: "a3", d: "acme.com", s: 1 },
    { id: "b1", d: "beta.com", s: 2 },
  ];
  const pr = partitionByDomain(scored, (r) => r.d, (r) => r.s);
  const pp = pr.probes.map((r) => r.id).sort().join(",");
  pp === "a2,b1" && pr.probes.length + pr.rest.length === scored.length
    ? ok(`probeScore → probes [${pr.probes.map((r) => r.id).join(",")}]`)
    : fail(`probeScore probes=[${pr.probes.map((r) => r.id).join(",")}] rest=[${pr.rest.map((r) => r.id).join(",")}]`);
}

console.log("\n== verifyRanked (parallel candidate verify, same winner) ==");
{
  const cands = ["a", "b", "c", "d", "e"].map((x) => ({ email: `${x}@d.com` }));
  const mk = (statuses, mx = {}) => async (email) => ({ status: statuses[email] ?? "invalid", mx: mx[email] ?? "ok" });
  const isValid = (r) => r.status === "valid";
  const isMx = (r) => r.mx === "fail";

  // 1) priority-0 valid → only ONE probe (fast path preserved).
  {
    let calls = 0;
    const verify = async (e) => { calls++; return { status: e === "a@d.com" ? "valid" : "invalid", mx: "ok" }; };
    const r = await verifyRanked(cands, verify, isValid, isMx, { concurrency: 3 });
    r.winner?.cand.email === "a@d.com" && calls === 1 ? ok("priority-0 valid → 1 call") : fail(`priority-0 → ${r.winner?.cand.email}, calls=${calls}`);
  }
  // 2) HIGHEST-priority valid wins even if a later one is also valid (in same batch).
  {
    const verify = mk({ "c@d.com": "valid", "d@d.com": "valid" }); // both valid; c is higher priority
    const r = await verifyRanked(cands, verify, isValid, isMx, { concurrency: 5 });
    r.winner?.cand.email === "c@d.com" ? ok("highest-priority valid wins (c over d)") : fail(`winner ${r.winner?.cand.email} (want c)`);
  }
  // 3) MX fail → short-circuit, no winner.
  {
    const verify = mk({ "b@d.com": "valid" }, { "a@d.com": "fail" });
    const r = await verifyRanked(cands, verify, isValid, isMx, { concurrency: 3 });
    r.mxFail && !r.winner ? ok("mx fail → short-circuit") : fail(`mxFail=${r.mxFail} winner=${r.winner?.cand.email}`);
  }
  // 4) none valid → winner null, all probed.
  {
    const r = await verifyRanked(cands, mk({}), isValid, isMx, { concurrency: 2 });
    !r.winner && !r.mxFail && r.results.length === 5 ? ok("none valid → null, all 5 probed") : fail(`none-valid results=${r.results.length}`);
  }
}

console.log("\n== Company-email hints (vendor format template / mail domain) ==");
{
  const T = [
    ["jsmith@chelsfield.com", "flast", "chelsfield.com"], // real mailbox wlo@chelsfield.com
    ["flast@saudiacargo.com", "flast", "saudiacargo.com"],
    ["last@shikhara.com", "last", "shikhara.com"],
    ["john.smith@acme.com", "first.last", "acme.com"],
    ["j.doe@acme.co.uk", "f.last", "acme.co.uk"],
  ];
  for (const [e, pid, dom] of T) {
    const r = emailFormatTemplate(e);
    r?.patternId === pid && r?.domain === dom ? ok(`template ${e} → ${pid}`) : fail(`template ${e} → ${JSON.stringify(r)} (want ${pid})`);
  }
  // Real addresses are NOT templates (precision: a contact mailbox never seeds a pattern).
  for (const e of ["info@y-intercept.net", "sales@s2ceda.com", "ranmali@randoli.io", "support@fotor.com", "", null, "not-an-email"]) {
    emailFormatTemplate(e) === null ? ok(`not a template: ${e}`) : fail(`${e} wrongly read as template`);
  }
  const H = [
    ["info@y-intercept.net", "y-intercept.org", "y-intercept.net"], // site ≠ mail domain
    ["jsmith@gobi.vc", "gobi-gba.vc", "gobi.vc"],
    ["support@int.visionnav.com", "visionnav.com", "int.visionnav.com"], // mail subdomain kept
    ["info@dyxnet.com", "dyxnet.com", null], // same as website → no extra domain
    ["someone@gmail.com", "acme.com", null], // free mail → never a company domain
    [null, "acme.com", null],
  ];
  for (const [e, site, want] of H) {
    const got = companyMailDomainHint(e, site);
    got === want ? ok(`hint ${e} @ ${site} → ${want}`) : fail(`hint ${e} @ ${site} → ${got} (want ${want})`);
  }
}

console.log("\n== No-MX website → real mail domain (apollo_people (17)) ==");
{
  // [website, company, companyLinkedin, country, expected mail domain in the top-40 variants]
  const V = [
    ["hangsenginvestment.com", "Hang Seng Investment", "http://www.linkedin.com/company/hangsenginvestment", "Hong Kong", "hangseng.com"],
    ["dahsinginsurance.com", "Dah Sing Insurance Company Limited", null, "Hong Kong", "dahsing.com"],
    ["hktfinancialservices.com", "HKT Digital Ventures - Fintech", "http://www.linkedin.com/company/hkt-financial-services", "Hong Kong", "hkt.com"],
    ["westk.hk", "West Kowloon Cultural District Authority", "http://www.linkedin.com/company/westk", "Hong Kong", "wkcd.hk"],
    ["ea-dg.com.cn", "Earthasia Design Group (EADG)", "http://www.linkedin.com/company/eadg", "Hong Kong", "eadg.com"],
    ["macnicacytech.com", "Macnica Cytech Limited", null, "Hong Kong", "macnica.com"],
    ["mirumhongkong.com", "Mirum Hong Kong", null, "Hong Kong", "mirum.com"],
    ["tws-mps.com", "TWS Technology", null, "Hong Kong", "tws.com.hk"],
    ["ccbintl.com.hk", "CCB International (Holdings) Limited", null, "Hong Kong", "ccbintl.com"],
    ["dartslive.co.jp", "Dartslive", null, "Hong Kong", "dartslive.com"],
    ["melcocnc.com.br", "Melco", "http://www.linkedin.com/company/melco", "Hong Kong", "melco.com.hk"],
    ["gobi-gba.vc", "Gobi Partners GBA", "http://www.linkedin.com/company/gobipartners", "Hong Kong", "gobi.vc"],
    ["colourliving.shop", "COLOURLIVING", null, "Hong Kong", "colourliving.com.hk"],
    ["msig.com.hk", "MSIG Hong Kong", "http://www.linkedin.com/company/msighk", "Hong Kong", "msig.com"],
    ["digift.sg", "DigiFT", null, "Singapore", "digift.io"],
  ];
  for (const [site, co, li, country, want] of V) {
    const got = companyDomainVariants(site, co, 40, { country, companyLinkedin: li });
    got.includes(want) ? ok(`${site} → ${want} (#${got.indexOf(want) + 1})`) : fail(`${site} → missing ${want}; got ${got.slice(0, 12).join(", ")}`);
    if (got.includes(site)) fail(`${site} re-proposed itself`);
  }
  // Precision gate: structural matches pass without a page; generic single words,
  // "(Europe)"-style parentheses and parked TLD swaps never do.
  const M = [
    ["hangseng.com", "hangsenginvestment.com", "Hang Seng Investment", null, true],
    ["dahsing.com.hk", "dahsinginsurance.com", "Dah Sing Insurance Company Limited", null, true],
    ["eadg.com", "ea-dg.com.cn", "Earthasia Design Group (EADG)", null, true],
    ["gobipartners.com", "gobi-gba.vc", "Gobi Partners GBA", "http://www.linkedin.com/company/gobipartners", true],
    ["randoli.com", "randoli.io", "Randoli", null, true],
    ["cricket.com", "crickethongkong.com", "Cricket Hong Kong, China", null, false],
    ["two.com", "cliv.io", "TWO EIGHT ONE", null, false],
    ["west.com", "westk.hk", "West Kowloon Cultural District Authority", null, false],
    ["europe.com", "icbc.eu", "ICBC (Europe)", null, false],
    ["magic.com", "magic-inno.com", "Microbiota I-Center (MagIC) (香港微生物菌群創新中心)", null, false],
    ["lesambassadeurs.ai", "lesambassadeurs.com", "Les Ambassadeurs Casino", null, false],
    ["tech.io", "tech.design", "Tech Design", null, false],
  ];
  for (const [v, site, co, li, want] of M) {
    const got = strongVariantMatch(v, { websiteDomain: site, companyName: co, companyLinkedin: li });
    got === want ? ok(`strong ${v} for ${site} = ${want}`) : fail(`strong ${v} for ${site} = ${got} (want ${want})`);
  }
  const P = [
    ["<h1>Cricket news, scores</h1>", "crickethongkong.com", "Cricket Hong Kong, China", "cricket.com", false],
    ["<p>Cricket Hong Kong, China — official site</p>", "crickethongkong.com", "Cricket Hong Kong, China", "cricket.com", true],
    ["<p>lesambassadeurs.ai — This domain is for sale!</p>", "lesambassadeurs.com", "Les Ambassadeurs Casino", "lesambassadeurs.ai", false],
    ["<title>lisboa.io</title>", "lisboa.com.hk", "Lisboa Food & Wines Limited (Hong Kong)", "lisboa.io", false],
    ["<footer>© West Kowloon Cultural District Authority</footer>", "westk.hk", "West Kowloon Cultural District Authority", "wkcd.hk", true],
  ];
  for (const [html, site, co, v, want] of P) {
    const got = variantPageRelevant(html, { websiteDomain: site, companyName: co, country: "Hong Kong", variant: v });
    got === want ? ok(`page ${v} relevant = ${want}`) : fail(`page ${v} relevant = ${got} (want ${want})`);
  }
  // Site-published mail domains: redirect target first, then printed addresses;
  // tooling domains (Wix/Sentry/onmicrosoft) and free mail are never candidates.
  const S = [
    ["gobi-gba.vc", "<html></html>", "www.gobi.vc", ["gobi.vc"]],
    ["y-intercept.org", '<a href="mailto:info@y-intercept.net">info@y-intercept.net</a>', null, ["y-intercept.net"]],
    ["colourliving.shop", "x@bschk.onmicrosoft.com sales@colourliving.com", null, ["colourliving.com"]],
    ["tinsol.net", '"dsn":"https://abc@sentry-next.wixpress.com/1" help@gmail.com', null, []],
    ["uming.com.tw", "contact: pr@mail.uming.com.tw", null, []],
    ["trendenterprises.com", "Email: sales&#64;trendent.com", null, ["trendent.com"]],
    ["asiainsurance.hk", "info@afh.hk icon@2x.png", null, ["afh.hk"]],
  ];
  for (const [site, html, fh, want] of S) {
    const got = extractSiteMailDomains(html, site, fh);
    JSON.stringify(got) === JSON.stringify(want) ? ok(`site-mail ${site} → [${want}]`) : fail(`site-mail ${site} → ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  }
}

console.log("\n== SMTP transient (greylist) detection — apollo_people (17) ==");
{
  // Mimecast answers an UNKNOWN recipient with 451 but a real one with 250
  // (rachael.lee@howdengroup.com, ricky.lui@hysan.com.hk) → must NOT read as opaque.
  const G = [
    [{ type: "AsyncSmtpError", message: "transient: Internal resource temporarily unavailable - https://community.mimecast.com/docs/DOC-1369#451" }, true],
    [{ type: "AsyncSmtpError", message: "451 4.7.1 Greylisted, please try again later" }, true],
    [{ type: "AsyncSmtpError", message: "permanent: 5.7.1 Service unavailable; client [51.68.203.255] blocked using Proofpoint Dynamic Reputation" }, false],
    [{ type: "AsyncSmtpError", message: "permanent: Blocked - see https://ipcheck.proofpoint.com/?ip=51.195.149.22" }, false],
    [{ type: "Microsoft365Error", message: { ReqwestError: "error sending request for url (https://login.microsoftonline.com/common/GetCredentialType)" } }, false],
    [{ type: "Socks5", message: "Error with reply: General failure." }, false],
    [null, false],
  ];
  for (const [err, want] of G) {
    const got = smtpTransientError(err);
    got === want ? ok(`transient=${want}: ${JSON.stringify(err).slice(0, 70)}`) : fail(`transient=${got} (want ${want}): ${JSON.stringify(err).slice(0, 90)}`);
  }
}

console.log(`\n${failures === 0 ? "ALL PASS ✅" : `${failures} FAILURE(S) ❌`}`);
process.exit(failures === 0 ? 0 : 1);

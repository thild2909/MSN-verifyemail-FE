import XLSX from "xlsx";
const BASE = "http://localhost:8090";
const N = Number(process.argv[2] || 15);
const CONC = Number(process.argv[3] || 3);

const wb = XLSX.readFile("C:/MSN verify email/indeed_sg_companies_with_clevel_linkedin.xlsx");
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Companies"], { defval: "" }).slice(0, N);
function dom(u) { if (!u) return ""; try { return new URL(/^https?:\/\//.test(u) ? u : "https://" + u).hostname.replace(/^www\./, ""); } catch { return u.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]; } }
function label(h) { const p = (h || "").split("."); if (p.length <= 2) return p[0] || ""; const two = /^(co|com|net|org|gov|edu|ac)\.[a-z]{2}$/i; const tail = p.slice(-2).join("."); return (two.test(tail) ? p[p.length - 3] : p[p.length - 2]) || ""; }

const items = rows.map((r) => ({ company: String(r["Company Name"]).trim(), location: String(r["Location"]).trim() || "Singapore", truth: dom(String(r["Website"]).trim()) }));
const t0 = Date.now();
let next = 0, match = 0;
const prov = {}, results = [];
async function worker() {
  while (next < items.length) {
    const it = items[next++];
    try {
      const d = await (await fetch(`${BASE}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company: it.company, location: it.location }) })).json();
      const rd = d.website ? dom(d.website) : "";
      const ok = rd && it.truth && (label(rd) === label(it.truth) || rd.endsWith(it.truth) || it.truth.endsWith(rd));
      if (ok) match++;
      const p = (d.log?.find((l) => l.step === "resolve")?.detail || "").split("·")[0].trim() || "-";
      prov[p] = (prov[p] || 0) + 1;
      results.push({ c: it.company, rd, td: it.truth, ok, p, score: d.match_score });
    } catch (e) { results.push({ c: it.company, err: String(e).slice(0, 40) }); }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${(r.c || "").slice(0, 30).padEnd(30)} → ${(r.rd || r.err || "-").padEnd(26)} truth=${(r.td || "-").padEnd(22)} [${r.p || "-"}]`);
console.log(`\nACCURACY: ${match}/${items.length} = ${Math.round((match / items.length) * 100)}%`);
console.log(`PROVIDERS: ${JSON.stringify(prov)}  (brave = free, serper = quota used)`);
console.log(`time: ${Math.round((Date.now() - t0) / 1000)}s @ concurrency ${CONC}`);

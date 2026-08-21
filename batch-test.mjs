import XLSX from "xlsx";
const BASE = "http://localhost:3000";
const N = Number(process.argv[2] || 30);

const wb = XLSX.readFile("C:/MSN verify email/indeed_sg_companies_with_clevel_linkedin.xlsx");
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Companies"], { defval: "" }).slice(0, N);
const payload = { name: "Indeed SG batch", fileName: "indeed.xlsx", rows: rows.map((r) => ({ company: String(r["Company Name"]).trim(), location: String(r["Location"]).trim() || "Singapore" })) };
const truth = new Map(rows.map((r) => [String(r["Company Name"]).trim(), dom(String(r["Website"]).trim())]));

function dom(u) { if (!u) return ""; try { return new URL(/^https?:\/\//.test(u) ? u : "https://" + u).hostname.replace(/^www\./, ""); } catch { return u.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]; } }
function label(h) { const p = (h || "").split("."); if (p.length <= 2) return p[0] || ""; const two = /^(co|com|net|org|gov|edu|ac)\.[a-z]{2}$/i; const tail = p.slice(-2).join("."); return (two.test(tail) ? p[p.length - 3] : p[p.length - 2]) || ""; }

const t0 = Date.now();
const cr = await (await fetch(`${BASE}/api/v1/leads/collect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })).json();
const id = cr.data.id;
console.log("job", id, "| companies", N);
let job;
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 6000));
  job = (await (await fetch(`${BASE}/api/v1/leads/collect/${id}`)).json()).data;
  process.stdout.write(`\r[${i}] ${job.status} ${job.progress}% resolved ${job.summary.resolved}/${N}      `);
  if (job.status === "completed") break;
}
console.log();
const comps = (await (await fetch(`${BASE}/api/v1/leads/collect/${id}/companies`)).json()).data.companies;

let match = 0, accepted = 0, review = 0, notfound = 0;
const prov = {};
for (const c of comps) {
  const rd = c.website ? dom(String(c.website.value)) : c.resolution?.website ? dom(c.resolution.website) : "";
  const td = truth.get(c.inputName) || "";
  const ok = rd && td && (label(rd) === label(td) || rd.endsWith(td) || td.endsWith(rd));
  if (ok) match++;
  const conf = c.resolution?.confidence ?? 0;
  if (c.status === "not_found" || !rd) notfound++;
  else if (conf >= 85) accepted++;
  else review++;
  const p = c.resolution?.provider ?? "-";
  prov[p] = (prov[p] || 0) + 1;
  console.log(`${ok ? "✓" : "✗"} ${c.inputName.slice(0, 30).padEnd(30)} → ${(rd || "-").padEnd(26)} truth=${(td || "-").padEnd(24)} score=${String(c.matchScore ?? "-").padStart(3)} conf=${conf} [${p}]`);
}
console.log(`\nACCURACY vs ground-truth website: ${match}/${comps.length} = ${Math.round((match / comps.length) * 100)}%`);
console.log(`status: accepted(≥85) ${accepted} | needs_review ${review} | not_found ${notfound}`);
console.log(`providers (block=0 check → no "blocked"): ${JSON.stringify(prov)}`);
console.log(`time: ${Math.round((Date.now() - t0) / 1000)}s`);
await fetch(`${BASE}/api/v1/leads/collect/${id}`, { method: "DELETE" });

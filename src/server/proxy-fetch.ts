/**
 * Real proxy-backed HTTP fetch, implemented by shelling out to `curl` (present
 * on Windows 10+ and every Linux/mac). Node 24 has no built-in way to route
 * `fetch` through a proxy without the `undici` package (not installed here), and
 * curl handles HTTP/HTTPS/SOCKS5 proxies + auth + timeouts natively — the same
 * command Webshare's quickstart shows. No new npm dependency.
 */
import "server-only";
import { spawn } from "node:child_process";

export interface ProxyLike {
  type: "http" | "https" | "socks5";
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface ProxyFetchResult {
  ok: boolean;
  status: number | null;
  body: string;
  ms: number;
  error?: string;
}

const STATUS_MARK = "\n__HTTP_STATUS__";

/**
 * Fingerprint rotation: real browsers vary their User-Agent / Accept-Language,
 * and reusing one signature across every request is a fast way to get blocked.
 * We rotate a small pool of realistic desktop-browser fingerprints, chosen
 * deterministically from a caller-supplied key so retries can pick a fresh one.
 */
const FINGERPRINTS: { ua: string; lang: string }[] = [
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36", lang: "en-US,en;q=0.9" },
  { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15", lang: "en-US,en;q=0.9" },
  { ua: "Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0", lang: "en-GB,en;q=0.8" },
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0", lang: "en-US,en;q=0.9" },
  { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36", lang: "en-US,en;q=0.7" },
];

/** Deterministic fingerprint for a key (0..n-1); `bump` picks the next one on retry. */
export function pickFingerprint(key: string, bump = 0): { ua: string; lang: string } {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return FINGERPRINTS[((h >>> 0) + bump) % FINGERPRINTS.length];
}

export function proxyUrl(p: ProxyLike): string {
  const scheme = p.type === "socks5" ? "socks5h" : "http"; // socks5h = resolve DNS on the proxy
  const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? "")}@` : "";
  return `${scheme}://${auth}${p.host}:${p.port}`;
}

/**
 * Fetch `url` (optionally through `proxy` — null = direct). Returns the body,
 * HTTP status and latency. Never throws; failures come back as `ok:false`.
 */
export function fetchViaProxy(
  url: string,
  proxy: ProxyLike | null,
  opts: { timeoutMs?: number; maxBytes?: number; fingerprint?: { ua: string; lang: string }; headers?: Record<string, string>; method?: string; body?: string } = {},
): Promise<ProxyFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  // Generous cap: real homepages are usually < 1MB. curl appends the status via
  // `-w` at the very END of stdout, so we must NOT kill mid-download for normal
  // pages or we'd lose the status marker and misread a 200 as a failure.
  const maxBytes = opts.maxBytes ?? 1_500_000;
  const start = Date.now();

  const fp = opts.fingerprint ?? FINGERPRINTS[0];
  const args = [
    "-sS", "-L", "--compressed",
    "--connect-timeout", "6",
    "--max-time", String(Math.ceil(timeoutMs / 1000)),
    "-A", fp.ua,
    "-H", `Accept-Language: ${fp.lang}`,
    "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
    "-w", `${STATUS_MARK}%{http_code}`,
  ];
  for (const [k, v] of Object.entries(opts.headers ?? {})) args.push("-H", `${k}: ${v}`);
  if (opts.method && opts.method !== "GET") args.push("-X", opts.method);
  if (opts.body != null) args.push("--data-binary", opts.body);
  if (proxy) args.push("--proxy", proxyUrl(proxy));
  args.push(url);

  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let killed = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("curl", args, { windowsHide: true });
    } catch (e) {
      resolve({ ok: false, status: null, body: "", ms: Date.now() - start, error: e instanceof Error ? e.message : "spawn failed" });
      return;
    }
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
      if (out.length > maxBytes && !killed) { killed = true; child.kill(); }
    });
    child.stderr?.on("data", (d: Buffer) => { err += d.toString(); });
    child.on("error", (e) => resolve({ ok: false, status: null, body: "", ms: Date.now() - start, error: e.message }));
    child.on("close", (code) => {
      const idx = out.lastIndexOf(STATUS_MARK);
      let status: number | null = null;
      let body = out;
      if (idx >= 0) {
        status = Number(out.slice(idx + STATUS_MARK.length).trim()) || null;
        body = out.slice(0, idx);
      }
      // ok if we got a 2xx/3xx status, OR we deliberately truncated an oversized
      // page (status marker lost) but still captured usable HTML.
      const ok = (!!status && status >= 200 && status < 400) || (killed && body.length > 500);
      resolve({ ok, status, body, ms: Date.now() - start, error: ok ? undefined : (err.trim() || (code ? `curl exit ${code}` : undefined)) });
    });
  });
}

/** Verify a proxy works by fetching an "what is my IP" endpoint through it. */
export async function checkProxyIp(proxy: ProxyLike, timeoutMs = 12_000): Promise<{ ok: boolean; ip?: string; ms: number; error?: string }> {
  const res = await fetchViaProxy("https://api.ipify.org", proxy, { timeoutMs, maxBytes: 2_000 });
  const ip = res.body.trim();
  const looksIp = /^[0-9a-f:.]{7,45}$/i.test(ip);
  return { ok: res.ok && looksIp, ip: looksIp ? ip : undefined, ms: res.ms, error: res.ok ? undefined : res.error };
}

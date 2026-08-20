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
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<ProxyFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  // Generous cap: real homepages are usually < 1MB. curl appends the status via
  // `-w` at the very END of stdout, so we must NOT kill mid-download for normal
  // pages or we'd lose the status marker and misread a 200 as a failure.
  const maxBytes = opts.maxBytes ?? 1_500_000;
  const start = Date.now();

  const args = [
    "-sS", "-L", "--compressed",
    "--connect-timeout", "6",
    "--max-time", String(Math.ceil(timeoutMs / 1000)),
    "-A", "Mozilla/5.0 (compatible; LeadsCollector/1.0)",
    "-w", `${STATUS_MARK}%{http_code}`,
  ];
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

/**
 * Server-side store for the collection PROXY configuration.
 *
 * Holds the proxy pool + rotation/delay/backoff settings the company collector
 * routes its requests through. Persists to `.data/proxy.json`. Credentials are
 * kept server-side and NEVER returned to the client (only a `hasAuth` flag).
 */
import "server-only";
import fs from "fs";
import path from "path";
import { checkProxyIp } from "./proxy-fetch";
import { DEFAULT_PROXY_CONFIG, type ProxyConfig, type ProxyEntry, type ProxyHealth } from "@/lib/leads/collect-types";

interface StoredProxy extends ProxyEntry {
  password?: string; // never serialised back to the client
}
interface StoredConfig extends Omit<ProxyConfig, "proxies"> {
  proxies: StoredProxy[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "proxy.json");

declare global {
  // eslint-disable-next-line no-var
  var __proxyStore: StoredConfig | undefined;
}

function load(): StoredConfig {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (parsed && Array.isArray(parsed.proxies)) return parsed as StoredConfig;
    }
  } catch { /* start from defaults */ }
  const seed = { ...DEFAULT_PROXY_CONFIG } as StoredConfig;
  persist(seed);
  return seed;
}

function store(): StoredConfig {
  if (!globalThis.__proxyStore) globalThis.__proxyStore = load();
  return globalThis.__proxyStore;
}

function persist(cfg: StoredConfig) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(cfg));
  } catch { /* best-effort */ }
}

/** Strip credentials for anything leaving the server. */
function sanitize(cfg: StoredConfig): ProxyConfig {
  return {
    enabled: cfg.enabled,
    rotation: cfg.rotation,
    concurrency: cfg.concurrency,
    delayMs: cfg.delayMs,
    backoffMs: cfg.backoffMs,
    maxRetries: cfg.maxRetries,
    proxies: cfg.proxies.map(({ password, ...p }) => ({ ...p, hasAuth: Boolean(password || p.username) })),
  };
}

export function getProxyConfig(): ProxyConfig {
  return sanitize(store());
}

/** Internal: the raw config (with credentials) — for the collector only. */
export function getProxyConfigInternal(): StoredConfig {
  return store();
}

export interface ProxyInput extends Omit<ProxyEntry, "id" | "hasAuth" | "status" | "lastLatencyMs"> {
  id?: string;
  password?: string;
  status?: ProxyHealth;
  lastLatencyMs?: number;
}

export interface ProxyConfigInput extends Omit<ProxyConfig, "proxies"> {
  proxies: ProxyInput[];
}

/** Replace the whole config. Preserves stored passwords for existing proxies. */
export function setProxyConfig(input: ProxyConfigInput): ProxyConfig {
  const prev = store();
  const byId = new Map(prev.proxies.map((p) => [p.id, p]));
  const proxies: StoredProxy[] = input.proxies.map((p, i) => {
    const id = p.id ?? `px_${Date.now().toString(36)}${i}`;
    const existing = byId.get(id);
    // Keep the existing password unless a new one is supplied.
    const password = p.password && p.password !== "••••••" ? p.password : existing?.password;
    return {
      id,
      label: p.label || `${p.host}:${p.port}`,
      host: p.host,
      port: p.port,
      type: p.type,
      username: p.username,
      country: p.country,
      enabled: p.enabled,
      hasAuth: Boolean(password || p.username),
      status: existing?.status ?? "untested",
      lastLatencyMs: existing?.lastLatencyMs,
      password,
    };
  });
  const next: StoredConfig = {
    enabled: input.enabled,
    rotation: input.rotation,
    concurrency: Math.max(1, Math.min(input.concurrency, 20)),
    delayMs: Math.max(0, input.delayMs),
    backoffMs: Math.max(0, input.backoffMs),
    maxRetries: Math.max(0, Math.min(input.maxRetries, 5)),
    proxies,
  };
  globalThis.__proxyStore = next;
  persist(next);
  return sanitize(next);
}

/**
 * REAL health check: connect through each proxy to an "what is my IP" endpoint
 * and record the exit IP + latency. Runs proxies in parallel. Pass an `id` to
 * test just one.
 */
export async function testProxies(id?: string): Promise<ProxyConfig> {
  const cfg = store();
  const targets = cfg.proxies.filter((p) => !id || p.id === id);
  await Promise.all(
    targets.map(async (p) => {
      if (!p.enabled) { p.status = "untested"; p.exitIp = undefined; p.lastLatencyMs = undefined; return; }
      const r = await checkProxyIp({ type: p.type, host: p.host, port: p.port, username: p.username, password: p.password });
      if (!r.ok) {
        const health: ProxyHealth = "dead";
        p.status = health; p.lastLatencyMs = undefined; p.exitIp = undefined;
      } else {
        p.status = r.ms > 1500 ? "slow" : "healthy";
        p.lastLatencyMs = r.ms;
        p.exitIp = r.ip;
      }
    }),
  );
  persist(cfg);
  return sanitize(cfg);
}

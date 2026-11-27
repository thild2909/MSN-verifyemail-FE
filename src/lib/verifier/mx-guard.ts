/**
 * SMTP-SSRF guard. The verification engine opens TCP:25 to a domain's MX hosts
 * (or its A record when there is no MX). A domain whose mail servers resolve to
 * loopback / private / link-local addresses would make the engine probe our own
 * internal network, so such addresses are never handed to the engine: they are
 * reported as undeliverable without any connection being made (an internal
 * address cannot receive internet mail anyway).
 */
import { resolveMx, lookup } from "node:dns/promises";
import { isIP } from "node:net";

function privateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return privateV4(ip);
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    if (s.startsWith("::ffff:")) return privateV4(s.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
  }
  return true;
}

async function hostIsPrivate(host: string): Promise<boolean> {
  if (isIP(host)) return isPrivateIp(host);
  if (host === "localhost" || /\.(localhost|local|internal)$/i.test(host)) return true;
  try {
    const addrs = await lookup(host, { all: true, verbatim: true });
    return addrs.some((a) => isPrivateIp(a.address));
  } catch {
    return false; // unresolvable → the engine will report it; nothing to reach
  }
}

const cache = new Map<string, { blocked: boolean; at: number }>();
const TTL_MS = 10 * 60_000;

/** True when ANY mail server of `domain` resolves to a non-public address. */
export async function mailTargetsPrivate(domain: string): Promise<boolean> {
  const d = domain.trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!d) return false;
  const hit = cache.get(d);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.blocked;
  let blocked: boolean;
  if (isIP(d)) {
    blocked = isPrivateIp(d);
  } else {
    let hosts: string[] = [];
    try {
      hosts = (await resolveMx(d)).map((m) => m.exchange).filter(Boolean);
    } catch {
      hosts = [];
    }
    // RFC 5321 implicit MX: no MX records → the domain's own A/AAAA.
    if (hosts.length === 0) hosts = [d];
    blocked = (await Promise.all(hosts.slice(0, 10).map(hostIsPrivate))).some(Boolean);
  }
  if (cache.size > 5000) cache.clear();
  cache.set(d, { blocked, at: Date.now() });
  return blocked;
}

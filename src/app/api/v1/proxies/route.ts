import { NextResponse } from "next/server";
import { z } from "zod";
import { getProxyConfigRemote, setProxyConfigRemote } from "@/server/crawler-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const proxySchema = z.object({
  id: z.string().optional(),
  label: z.string().default(""),
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  type: z.enum(["http", "https", "socks5"]),
  username: z.string().optional(),
  password: z.string().optional(),
  country: z.string().optional(),
  enabled: z.boolean().default(true),
});

const configSchema = z.object({
  enabled: z.boolean(),
  rotation: z.enum(["round_robin", "random", "sticky_per_domain"]),
  concurrency: z.number().int().min(1).max(20),
  delayMs: z.number().int().min(0),
  backoffMs: z.number().int().min(0),
  maxRetries: z.number().int().min(0).max(5),
  proxies: z.array(proxySchema).max(200),
});

function unavailable(err: unknown) {
  return NextResponse.json(
    { success: false, error: { code: "CRAWLER_UNAVAILABLE", message: `Crawler service unreachable: ${err instanceof Error ? err.message : "unknown"}` } },
    { status: 502 },
  );
}

export async function GET() {
  try {
    return NextResponse.json({ success: true, data: await getProxyConfigRemote() });
  } catch (err) {
    // Degrade gracefully so the Proxy settings UI still opens (shows offline)
    // instead of erroring when the crawler service is momentarily down.
    return NextResponse.json({
      success: true,
      warning: `Crawler service offline: ${err instanceof Error ? err.message : "unreachable"}`,
      data: { enabled: false, rotation: "round_robin", concurrency: 3, delayMs: 800, backoffMs: 2000, maxRetries: 2, proxies: [] },
    });
  }
}

export async function PUT(req: Request) {
  const parsed = configSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid config." } }, { status: 400 });
  }
  try {
    return NextResponse.json({ success: true, data: await setProxyConfigRemote(parsed.data) });
  } catch (err) {
    return unavailable(err);
  }
}

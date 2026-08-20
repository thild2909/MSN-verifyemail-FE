import { NextResponse } from "next/server";
import { z } from "zod";
import * as store from "@/server/proxy-store";

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
  proxies: z.array(proxySchema).max(100),
});

export async function GET() {
  return NextResponse.json({ success: true, data: store.getProxyConfig() });
}

export async function PUT(req: Request) {
  const parsed = configSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid config." } }, { status: 400 });
  }
  return NextResponse.json({ success: true, data: store.setProxyConfig(parsed.data) });
}

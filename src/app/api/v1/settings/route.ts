import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettingsRemote, setSettingsRemote } from "@/server/crawler-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Whitelist of editable runtime settings. Values are free-form strings; an empty
// string clears the override, a masked value keeps the existing secret.
const SETTING_KEYS = [
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_MODEL",
  "CRAWLER_ROTATING_PROXY",
  "CRAWLER_PROXY_LIST_URL",
  "DECODO_AUTH",
  "GOOGLE_API_KEY",
  "GOOGLE_CX",
] as const;

const patchSchema = z
  .object(Object.fromEntries(SETTING_KEYS.map((k) => [k, z.string()])) as Record<(typeof SETTING_KEYS)[number], z.ZodString>)
  .partial();

function unavailable(err: unknown) {
  return NextResponse.json(
    { success: false, error: { code: "CRAWLER_UNAVAILABLE", message: `Crawler service unreachable: ${err instanceof Error ? err.message : "unknown"}` } },
    { status: 502 },
  );
}

export async function GET() {
  try {
    return NextResponse.json({ success: true, data: await getSettingsRemote() });
  } catch (err) {
    // Degrade gracefully so the Config tab still opens (shows offline) instead
    // of erroring when the crawler service is momentarily down.
    return NextResponse.json({
      success: true,
      warning: `Crawler service offline: ${err instanceof Error ? err.message : "unreachable"}`,
      data: { fields: [] },
    });
  }
}

export async function PUT(req: Request) {
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid settings." } }, { status: 400 });
  }
  try {
    return NextResponse.json({ success: true, data: await setSettingsRemote(parsed.data) });
  } catch (err) {
    return unavailable(err);
  }
}

import { NextResponse } from "next/server";
import { getAiProvidersViaCrawler } from "@/server/crawler-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which AI providers (DeepSeek / ChatGPT) are configured for Find with AI. */
export async function GET() {
  try {
    const providers = await getAiProvidersViaCrawler();
    return NextResponse.json({ success: true, data: { providers } });
  } catch {
    return NextResponse.json({ success: true, data: { providers: [] } });
  }
}

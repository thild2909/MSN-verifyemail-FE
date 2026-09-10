import { NextResponse } from "next/server";
import { extractFileText } from "@/server/docx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB upload ceiling

/**
 * Extract the plain text of an uploaded agent brief (.docx / .txt / .md) so it
 * can be fed to Find with AI as the system instructions. Nothing is stored.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "Expected a multipart upload." } }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "No file provided." } }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ success: false, error: { code: "TOO_LARGE", message: "File exceeds the 10 MB limit." } }, { status: 413 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const { text, chars } = extractFileText(file.name, bytes);
    if (!text.trim()) {
      return NextResponse.json({ success: false, error: { code: "EMPTY", message: "No readable text found in the file." } }, { status: 422 });
    }
    return NextResponse.json({ success: true, data: { fileName: file.name, chars, text } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: "PARSE_FAILED", message: (err as Error).message || "Could not read the file." } },
      { status: 422 },
    );
  }
}

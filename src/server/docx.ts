import "server-only";
import { inflateRawSync } from "node:zlib";

/**
 * Dependency-free text extraction for uploaded agent briefs.
 *
 * A .docx is a ZIP archive; the body text lives in `word/document.xml`. We read
 * the ZIP central directory (authoritative sizes, unlike local headers which may
 * use streaming data descriptors), inflate that one entry, and strip the XML to
 * plain text. .txt / .md are returned verbatim. No third-party parser needed.
 */

const EOCD_SIG = 0x06054b50; // End Of Central Directory
const CEN_SIG = 0x02014b50; // Central directory file header
const LOC_SIG = 0x04034b50; // Local file header

function findEntryOffsetInCentralDir(buf: Buffer, wanted: string): { offset: number; method: number; compSize: number } | null {
  // Locate EOCD by scanning backward (comment can be up to 65535 bytes).
  const minEocd = 22;
  let eocd = -1;
  for (let i = buf.length - minEocd; i >= 0 && i >= buf.length - (minEocd + 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const cdCount = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // offset of central directory start

  for (let n = 0; n < cdCount; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === wanted) return { offset: localOffset, method, compSize };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function readZipEntry(buf: Buffer, name: string): Buffer | null {
  const entry = findEntryOffsetInCentralDir(buf, name);
  if (!entry) return null;
  const lh = entry.offset;
  if (buf.readUInt32LE(lh) !== LOC_SIG) return null;
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + entry.compSize);
  if (entry.method === 0) return Buffer.from(data); // stored
  if (entry.method === 8) {
    try { return inflateRawSync(data); } catch { return null; }
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[ent.toLowerCase()] ?? m;
  });
}

/** Turn WordprocessingML into readable plain text (paragraph + tab aware). */
function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^>]*\/?>/gi, "\t")
    .replace(/<w:br\b[^>]*\/?>/gi, "\n")
    .replace(/<\/w:p>/gi, "\n")
    // Drop every remaining tag, keeping element text content.
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => decodeXmlEntities(line).replace(/ /g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ExtractedFile {
  text: string;
  chars: number;
}

/** Extract plain text from an uploaded brief by filename + bytes. */
export function extractFileText(fileName: string, bytes: Buffer): ExtractedFile {
  const lower = fileName.toLowerCase();
  let text = "";

  if (lower.endsWith(".docx")) {
    const xml = readZipEntry(bytes, "word/document.xml");
    if (!xml) throw new Error("Could not read word/document.xml from the .docx file.");
    text = docxXmlToText(xml.toString("utf8"));
  } else if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".markdown")) {
    text = bytes.toString("utf8").replace(/\r\n/g, "\n").trim();
  } else if (lower.endsWith(".doc")) {
    throw new Error("Legacy .doc is not supported — please save as .docx, .txt or .md.");
  } else {
    throw new Error("Unsupported file type. Upload a .docx, .txt or .md file.");
  }

  return { text, chars: text.length };
}

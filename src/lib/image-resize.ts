/**
 * Client-side image preparation for profile photos / cover images: decode the
 * picked file, cover-crop it to the target box, and encode a compact data URL
 * (WebP when the browser can, else JPEG), stepping quality down until it fits
 * the backend's size cap. Nothing leaves the browser until the caller sends it.
 */

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

export class ImageError extends Error {}

export interface ResizeOptions {
  width: number;
  height: number;
  /** Max length of the resulting data URL (matches the BE cap). */
  maxChars: number;
}

async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function resizeImageFile(file: File, opts: ResizeOptions): Promise<string> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new ImageError("Please choose a PNG, JPEG, WebP or GIF image.");
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImageError("That image is larger than 15 MB. Please choose a smaller one.");
  }

  let src: Awaited<ReturnType<typeof decode>>;
  try {
    src = await decode(file);
  } catch {
    throw new ImageError("This image couldn't be read. Try a different file.");
  }

  const { width: W, height: H } = opts;
  // Cover-crop: scale so the box is filled, then centre the overflow.
  const scale = Math.max(W / src.width, H / src.height);
  const dw = src.width * scale;
  const dh = src.height * scale;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("Your browser can't process images here.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  if ("close" in src && typeof (src as ImageBitmap).close === "function") (src as ImageBitmap).close();

  const webpOk = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  const mime = webpOk ? "image/webp" : "image/jpeg";
  for (const q of [0.88, 0.8, 0.7, 0.6, 0.5, 0.4]) {
    const out = canvas.toDataURL(mime, q);
    if (out.length <= opts.maxChars) return out;
  }
  throw new ImageError("This image is too detailed to compress. Try a simpler one.");
}

/** Limits mirror MSN-BE auth/routes.ts (AVATAR_MAX / BANNER_MAX). */
export const AVATAR_SPEC: ResizeOptions = { width: 256, height: 256, maxChars: 300_000 };
export const BANNER_SPEC: ResizeOptions = { width: 1500, height: 400, maxChars: 900_000 };

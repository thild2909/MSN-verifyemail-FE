"use client";
import * as React from "react";
import { Camera, Loader2, Trash2, Upload } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { TONES, avatarTone } from "@/components/settings/settings-ui";
import { resizeImageFile, ImageError, ACCEPTED_IMAGE_TYPES, AVATAR_SPEC } from "@/lib/image-resize";
import { cn, initials } from "@/lib/utils";

/**
 * Avatar field for forms: round preview (initials until a photo is picked),
 * click or drop to choose, remove link. Images are cropped/compressed in the
 * browser (256×256) and handed back as a data URL — the caller saves it.
 */
export function AvatarPicker({
  value, onChange, name, disabled,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  /** Used for the initials fallback + colour. */
  name: string;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const label = name.trim() || "?";

  const handle = async (file: File | undefined | null) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await resizeImageFile(file, AVATAR_SPEC));
    } catch (e) {
      toast({ variant: "error", title: "Couldn't use that image", description: e instanceof ImageError ? e.message : "Please try another file." });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div
      className={cn("flex items-center gap-4 rounded-xl border border-dashed p-3 transition-colors", dragging ? "border-brand bg-brand/[0.05]" : "border-border")}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (!disabled) handle(e.dataTransfer.files?.[0]); }}
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy}
        aria-label={value ? "Change photo" : "Upload photo"}
        className="group relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card text-lg font-semibold ring-2 ring-border transition-shadow hover:ring-brand/50 disabled:opacity-60"
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="size-full object-cover" />
        ) : (
          <span className={cn("flex size-full items-center justify-center", TONES[avatarTone(label)])}>{initials(label)}</span>
        )}
        <span className={cn("absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity", busy ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">Profile photo <span className="font-normal text-muted-foreground">(optional)</span></p>
        <p className="text-xs text-muted-foreground">Drop an image or browse · cropped to a square</p>
        <div className="mt-1.5 flex gap-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || busy}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-brand transition-colors hover:bg-brand/10 disabled:opacity-50"
          >
            <Upload className="size-3.5" /> {value ? "Change" : "Upload"}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={disabled || busy}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className="size-3.5" /> Remove
            </button>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => handle(e.target.files?.[0])}
      />
    </div>
  );
}

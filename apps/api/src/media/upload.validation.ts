import type { PostFormat } from "@intabot/shared";

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

const FORMAT_BY_MIME: Record<string, PostFormat> = {
  "image/jpeg": "IMAGE",
  "image/png": "IMAGE",
  "image/webp": "IMAGE",
  "video/mp4": "REEL",
  "video/quicktime": "REEL",
};

export function inferFormat(contentType: string): PostFormat | null {
  return FORMAT_BY_MIME[contentType] ?? null;
}

export interface UploadCandidate {
  mimetype: string;
  size: number;
}

export type UploadValidation = { ok: true; format: PostFormat } | { ok: false; reason: string };

export function validateUpload(file: UploadCandidate): UploadValidation {
  const format = inferFormat(file.mimetype);
  if (!format) return { ok: false, reason: `unsupported content type: ${file.mimetype}` };
  if (file.size <= 0) return { ok: false, reason: "file is empty" };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: `file exceeds ${MAX_UPLOAD_BYTES} bytes` };
  }
  return { ok: true, format };
}

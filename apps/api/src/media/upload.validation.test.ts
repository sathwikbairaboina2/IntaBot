import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, inferFormat, validateUpload } from "./upload.validation";

describe("inferFormat", () => {
  it("maps images to IMAGE and video to REEL", () => {
    expect(inferFormat("image/jpeg")).toBe("IMAGE");
    expect(inferFormat("image/png")).toBe("IMAGE");
    expect(inferFormat("video/mp4")).toBe("REEL");
  });

  it("returns null for unsupported types", () => {
    expect(inferFormat("application/pdf")).toBeNull();
    expect(inferFormat("image/gif")).toBeNull();
  });
});

describe("validateUpload", () => {
  const file = { mimetype: "image/jpeg", size: 1024 };

  it("accepts a small jpeg", () => {
    expect(validateUpload(file)).toEqual({ ok: true, format: "IMAGE" });
  });

  it("rejects an unsupported mime type", () => {
    const result = validateUpload({ ...file, mimetype: "application/pdf" });
    expect(result).toEqual({ ok: false, reason: "unsupported content type: application/pdf" });
  });

  it("rejects a file over the size cap", () => {
    const result = validateUpload({ ...file, size: MAX_UPLOAD_BYTES + 1 });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty file", () => {
    expect(validateUpload({ ...file, size: 0 }).ok).toBe(false);
  });
});

import { z } from "zod";
import { isoDateTime } from "./common.js";

export const MediaAssetSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  storageKey: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  widthPx: z.number().int().positive().optional(),
  heightPx: z.number().int().positive().optional(),
  durationSeconds: z.number().positive().optional(),
  /** Drafting exhausted its retries; awaiting manual drafting. */
  draftFailed: z.boolean().optional(),
  createdAt: isoDateTime,
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

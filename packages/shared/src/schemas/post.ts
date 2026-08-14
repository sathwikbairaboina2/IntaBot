import { z } from "zod";
import { isoDateTime } from "./common.js";

export const PostStatus = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "REJECTED",
]);
export type PostStatus = z.infer<typeof PostStatus>;

export const PostFormat = z.enum(["IMAGE", "REEL", "STORY", "CAROUSEL"]);
export type PostFormat = z.infer<typeof PostFormat>;

export const PostSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  status: PostStatus,
  format: PostFormat,
  version: z.number().int().nonnegative(),
  mediaAssetIds: z.array(z.string().min(1)).min(1),
  caption: z.string(),
  hashtags: z.array(z.string()),
  scheduledAt: isoDateTime,
  containerId: z.string().optional(),
  igMediaId: z.string().optional(),
  permalink: z.string().optional(),
  failureReason: z.string().optional(),
  /** Accessibility text produced alongside the caption. */
  altText: z.string().optional(),
  /** Copy generation refused or failed validation; a human must write it. */
  needsAttention: z.boolean().optional(),
  /** Published in dry-run mode; never reached Instagram. */
  dryRun: z.boolean().optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Post = z.infer<typeof PostSchema>;

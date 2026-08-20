import { z } from "zod";
import { isoDateTime } from "./common.js";

export const CommentStatus = z.enum([
  "RECEIVED",
  "AUTO_REPLIED",
  "ESCALATED",
  "HUMAN_REPLIED",
  "IGNORED",
]);
export type CommentStatus = z.infer<typeof CommentStatus>;

/** Stored verbatim as the model produced it, so dashboards and the audit log
 * show what was actually classified, not a normalised summary. */
export const ClassificationSchema = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]),
  intent: z.enum(["question", "praise", "complaint", "spam", "other"]),
  toxicity: z.number().min(0).max(1),
  isSpam: z.boolean(),
  needsHuman: z.boolean(),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const CommentSchema = z.object({
  igCommentId: z.string().min(1),
  accountId: z.string().min(1),
  postId: z.string().min(1),
  igMediaId: z.string().min(1),
  text: z.string(),
  fromIgUserId: z.string().min(1),
  fromUsername: z.string().min(1),
  status: CommentStatus,
  version: z.number().int().nonnegative(),
  classification: ClassificationSchema.optional(),
  /** The policy-gate rule (or human action) that produced the current status. */
  policyRule: z.string().optional(),
  replyText: z.string().optional(),
  replyId: z.string().optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Comment = z.infer<typeof CommentSchema>;

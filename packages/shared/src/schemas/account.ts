import { z } from "zod";
import { isoDateTime } from "./common.js";

export const AccountStatus = z.enum(["ACTIVE", "DEGRADED", "DISABLED"]);
export type AccountStatus = z.infer<typeof AccountStatus>;

export const AccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  igUserId: z.string().min(1),
  username: z.string().min(1),
  status: AccountStatus,
  accessTokenEncrypted: z.string().min(1),
  tokenExpiresAt: isoDateTime,
  dryRun: z.boolean().default(true),
  moderationPaused: z.boolean().default(false),
  /** Brand-voice fragment passed to the copy writer. */
  voice: z.string().optional(),
  /** IANA zone used for slot planning. */
  timezone: z.string().min(1).default("UTC"),
  /** Local HH:mm times at which posts may be scheduled. */
  postingWindows: z
    .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm"))
    .default(["09:00", "12:30", "18:00"]),
  /** Auto-replies allowed on one post within a rolling hour. */
  replyCapPerPostPerHour: z.number().int().positive().default(4),
  /** Auto-replies allowed across the account within a rolling hour. */
  replyCapPerAccountPerHour: z.number().int().positive().default(20),
  /** Comments containing any of these terms escalate, never auto-reply. */
  blocklist: z.array(z.string().min(1)).default([]),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Account = z.infer<typeof AccountSchema>;

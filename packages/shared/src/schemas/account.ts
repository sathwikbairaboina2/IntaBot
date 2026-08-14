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
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Account = z.infer<typeof AccountSchema>;

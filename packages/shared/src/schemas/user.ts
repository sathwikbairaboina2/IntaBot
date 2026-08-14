import { z } from "zod";
import { isoDateTime } from "./common.js";

export const UserSchema = z.object({
  email: z.string().email().toLowerCase(),
  passwordHash: z.string().min(1),
  createdAt: isoDateTime,
});
export type User = z.infer<typeof UserSchema>;

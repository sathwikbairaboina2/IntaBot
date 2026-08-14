import { z } from "zod";

export const isoDateTime = z.string().datetime();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

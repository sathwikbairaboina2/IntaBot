import { cache } from "react";
import type { AccountView } from "./api";
import * as api from "./api";

// One fetch per request, shared by the dashboard layout and the page under it.
export const getMe = cache(api.getMe);
export const getAccounts = cache(api.getAccounts);
export const getApprovals = cache(api.getApprovals);
export const getModeration = cache(api.getModeration);

export interface NavCounts {
  approvals: number | null;
  moderation: number | null;
}

async function total(calls: Promise<number>[]): Promise<number | null> {
  try {
    return (await Promise.all(calls)).reduce((sum, n) => sum + n, 0);
  } catch {
    return null;
  }
}

export async function getNavCounts(accounts: AccountView[]): Promise<NavCounts> {
  const [approvals, moderation] = await Promise.all([
    total(accounts.map(async (a) => (await getApprovals(a.id)).length)),
    total(accounts.map(async (a) => (await getModeration(a.id)).escalated.length)),
  ]);
  return { approvals, moderation };
}

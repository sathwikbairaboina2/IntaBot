import { cookies } from "next/headers";
import { API_BASE_URL, ApiError, buildUrl, parseResponse } from "./http";

export { ApiError } from "./http";

/** Server-side fetch that forwards the operator's session cookie. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(buildUrl(API_BASE_URL, path), {
    ...init,
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  return parseResponse<T>(res);
}

export interface AccountView {
  id: string;
  name: string;
  igUserId: string;
  username: string;
  status: "ACTIVE" | "DEGRADED" | "DISABLED";
  dryRun: boolean;
  moderationPaused: boolean;
  tokenExpiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export async function getAccounts(): Promise<AccountView[]> {
  return apiFetch<AccountView[]>("/accounts");
}

export async function getMe(): Promise<{ email: string } | null> {
  try {
    return await apiFetch<{ email: string }>("/auth/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export interface PostView {
  id: string;
  accountId: string;
  status: string;
  format: string;
  version: number;
  caption: string;
  hashtags: string[];
  altText?: string;
  needsAttention?: boolean;
  dryRun?: boolean;
  scheduledAt: string;
  permalink?: string;
}

export async function getApprovals(accountId: string): Promise<PostView[]> {
  return apiFetch<PostView[]>(`/approvals?accountId=${encodeURIComponent(accountId)}`);
}

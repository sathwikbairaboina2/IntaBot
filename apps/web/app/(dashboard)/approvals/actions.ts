"use server";

import { revalidatePath } from "next/cache";
import { ApiError, apiFetch } from "@/lib/api";

export interface ApprovalActionState {
  error?: string;
}

const CONFLICT_MESSAGE = "This post changed elsewhere. Refresh and try again.";

function target(formData: FormData) {
  return {
    postId: String(formData.get("postId")),
    accountId: String(formData.get("accountId")),
    expectedVersion: Number(formData.get("expectedVersion")),
  };
}

// A 409 means someone else changed the post since the card loaded; show it in
// the card instead of failing the whole page.
async function settle(call: () => Promise<unknown>): Promise<ApprovalActionState> {
  try {
    await call();
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return { error: CONFLICT_MESSAGE };
    throw err;
  }
  revalidatePath("/approvals");
  return {};
}

export async function approvePost(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const { postId, accountId, expectedVersion } = target(formData);
  return settle(() =>
    apiFetch(`/approvals/${postId}/approve`, {
      method: "POST",
      body: JSON.stringify({
        accountId,
        expectedVersion,
        caption: String(formData.get("caption")),
        hashtags: String(formData.get("hashtags")).split(/\s+/).filter(Boolean),
      }),
    }),
  );
}

export async function rejectPost(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const { postId, accountId, expectedVersion } = target(formData);
  return settle(() =>
    apiFetch(`/approvals/${postId}/reject`, {
      method: "POST",
      body: JSON.stringify({ accountId, expectedVersion }),
    }),
  );
}

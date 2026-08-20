"use server";

import { revalidatePath } from "next/cache";
import { ApiError, apiFetch } from "@/lib/api";

export interface ModerationActionState {
  error?: string;
}

const CONFLICT_MESSAGE = "This comment changed elsewhere — refresh and retry.";

export async function replyToComment(
  _prev: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  try {
    await apiFetch(`/moderation/${String(formData.get("igCommentId"))}/reply`, {
      method: "POST",
      body: JSON.stringify({
        accountId: String(formData.get("accountId")),
        postId: String(formData.get("postId")),
        expectedVersion: Number(formData.get("expectedVersion")),
        text: String(formData.get("text")),
      }),
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return { error: CONFLICT_MESSAGE };
    throw err;
  }
  revalidatePath("/moderation");
  return {};
}

export async function dismissComment(
  _prev: ModerationActionState,
  formData: FormData,
): Promise<ModerationActionState> {
  try {
    await apiFetch(`/moderation/${String(formData.get("igCommentId"))}/dismiss`, {
      method: "POST",
      body: JSON.stringify({
        accountId: String(formData.get("accountId")),
        postId: String(formData.get("postId")),
        expectedVersion: Number(formData.get("expectedVersion")),
      }),
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return { error: CONFLICT_MESSAGE };
    throw err;
  }
  revalidatePath("/moderation");
  return {};
}

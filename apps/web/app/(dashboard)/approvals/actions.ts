"use server";

import { revalidatePath } from "next/cache";
import { apiFetch } from "@/lib/api";

export async function approvePost(formData: FormData): Promise<void> {
  const body = {
    accountId: String(formData.get("accountId")),
    expectedVersion: Number(formData.get("expectedVersion")),
    caption: String(formData.get("caption")),
    hashtags: String(formData.get("hashtags")).split(/\s+/).filter(Boolean),
  };
  await apiFetch(`/approvals/${String(formData.get("postId"))}/approve`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  revalidatePath("/approvals");
}

export async function rejectPost(formData: FormData): Promise<void> {
  await apiFetch(`/approvals/${String(formData.get("postId"))}/reject`, {
    method: "POST",
    body: JSON.stringify({
      accountId: String(formData.get("accountId")),
      expectedVersion: Number(formData.get("expectedVersion")),
    }),
  });
  revalidatePath("/approvals");
}

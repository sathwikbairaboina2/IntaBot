"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiFetch } from "@/lib/api";

const SESSION_COOKIE = "intabot_session";

export async function logout(): Promise<void> {
  try {
    await apiFetch("/auth/logout", { method: "POST" });
  } catch {
    // The local cookie is dropped either way; an expired API session is fine.
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

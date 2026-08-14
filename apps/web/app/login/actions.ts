"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { API_BASE_URL, buildUrl } from "@/lib/http";

export async function login(_prev: string | null, formData: FormData): Promise<string | null> {
  const res = await fetch(buildUrl(API_BASE_URL, "/auth/login"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    }),
  });

  if (!res.ok) return "Invalid email or password.";

  // Re-issue the API's session cookie on this origin so server components
  // can forward it back on subsequent requests.
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const [pair] = setCookie.split(";");
    const [name, ...rest] = (pair ?? "").split("=");
    if (name) {
      (await cookies()).set(name, rest.join("="), {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    }
  }

  redirect("/");
}

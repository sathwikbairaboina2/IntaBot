import { cookies } from "next/headers";
import { API_BASE_URL, buildUrl } from "@/lib/http";

/**
 * Proxies the multipart upload so the browser never talks to the API origin
 * directly and the session cookie is forwarded server-side.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.formData();
  const res = await fetch(buildUrl(API_BASE_URL, "/media"), {
    method: "POST",
    headers: { cookie: (await cookies()).toString() },
    body,
  });
  return new Response(await res.text(), { status: res.status });
}

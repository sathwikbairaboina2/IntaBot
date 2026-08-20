// 4100, not 4000: another local project's API owns 4000, so the two could not
// run at the same time and requests would silently reach the wrong service.
export const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4100";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function buildUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(res.status, `API request failed with ${res.status}`);
  return (await res.json()) as T;
}

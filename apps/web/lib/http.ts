export const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4000";

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

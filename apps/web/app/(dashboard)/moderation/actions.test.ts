import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => {
  const http = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { apiFetch: vi.fn(), ApiError: http.ApiError };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { ApiError, apiFetch } from "@/lib/api";
import { dismissComment, replyToComment } from "./actions";

function form(): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ igCommentId: "c1", accountId: "a1", postId: "p1", expectedVersion: "2", text: "" })) {
    data.set(key, value);
  }
  return data;
}

beforeEach(() => vi.clearAllMocks());

describe("moderation conflicts", () => {
  it("uses the shared conflict copy for reply and dismiss", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(409, "conflict"));
    const expected = { error: "This comment changed elsewhere. Refresh and try again." };
    expect(await replyToComment({}, form())).toEqual(expected);
    expect(await dismissComment({}, form())).toEqual(expected);
  });
});

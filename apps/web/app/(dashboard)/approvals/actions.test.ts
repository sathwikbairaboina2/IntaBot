import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => {
  const http = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { apiFetch: vi.fn(), ApiError: http.ApiError };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import { ApiError, apiFetch } from "@/lib/api";
import { approvePost, rejectPost } from "./actions";

function form(extra: Record<string, string> = {}): FormData {
  const data = new FormData();
  const fields = { postId: "p1", accountId: "a1", expectedVersion: "3", caption: "", hashtags: "", ...extra };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const CONFLICT = { error: "This post changed elsewhere. Refresh and try again." };

beforeEach(() => vi.clearAllMocks());

describe("approvePost", () => {
  it("sends the caption and split hashtags, then revalidates", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({});
    expect(await approvePost({}, form({ caption: "Hi", hashtags: " #a  #b " }))).toEqual({});
    expect(apiFetch).toHaveBeenCalledWith("/approvals/p1/approve", {
      method: "POST",
      body: JSON.stringify({ accountId: "a1", expectedVersion: 3, caption: "Hi", hashtags: ["#a", "#b"] }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/approvals");
  });

  it("returns the conflict message on 409 and does not revalidate", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new ApiError(409, "conflict"));
    expect(await approvePost({}, form())).toEqual(CONFLICT);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rethrows other API errors", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new ApiError(500, "boom"));
    await expect(approvePost({}, form())).rejects.toThrow("boom");
  });

  it("clears a previous error after a later success", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({});
    expect(await approvePost(CONFLICT, form())).toEqual({});
  });
});

describe("rejectPost", () => {
  it("sends the account and version only", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({});
    expect(await rejectPost({}, form({ caption: "ignored" }))).toEqual({});
    expect(apiFetch).toHaveBeenCalledWith("/approvals/p1/reject", {
      method: "POST",
      body: JSON.stringify({ accountId: "a1", expectedVersion: 3 }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/approvals");
  });

  it("returns the conflict message on 409", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new ApiError(409, "conflict"));
    expect(await rejectPost({}, form())).toEqual(CONFLICT);
  });
});

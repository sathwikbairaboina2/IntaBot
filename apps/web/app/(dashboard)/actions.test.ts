import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteCookie } = vi.hoisted(() => ({ deleteCookie: vi.fn() }));

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ delete: deleteCookie })) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { logout } from "./actions";

beforeEach(() => vi.clearAllMocks());

describe("logout", () => {
  it("ends the API session, drops the cookie and goes to login", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({});
    await logout();
    expect(apiFetch).toHaveBeenCalledWith("/auth/logout", { method: "POST" });
    expect(deleteCookie).toHaveBeenCalledWith("intabot_session");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("still drops the cookie and redirects when the API call fails", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("down"));
    await logout();
    expect(deleteCookie).toHaveBeenCalledWith("intabot_session");
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});

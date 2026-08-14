import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, buildUrl, parseResponse } from "./http";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildUrl", () => {
  it("joins the base and path without doubling slashes", () => {
    expect(buildUrl("http://localhost:4000", "/accounts")).toBe("http://localhost:4000/accounts");
    expect(buildUrl("http://localhost:4000/", "/accounts")).toBe("http://localhost:4000/accounts");
  });
});

describe("parseResponse", () => {
  it("returns the parsed body on 200", async () => {
    const res = new Response(JSON.stringify({ ok: true }), { status: 200 });
    await expect(parseResponse<{ ok: boolean }>(res)).resolves.toEqual({ ok: true });
  });

  it("throws ApiError carrying the status on 401", async () => {
    const res = new Response("{}", { status: 401 });
    await expect(parseResponse(res)).rejects.toMatchObject({ status: 401 });
  });

  it("throws ApiError on 500", async () => {
    const res = new Response("boom", { status: 500 });
    await expect(parseResponse(res)).rejects.toBeInstanceOf(ApiError);
  });
});

import { describe, expect, it } from "vitest";
import { tokenDaysLeft } from "./token-expiry";

const now = new Date("2026-11-26T10:00:00.000Z");

describe("tokenDaysLeft", () => {
  it("counts whole days remaining", () => {
    expect(tokenDaysLeft("2026-12-26T10:00:00.000Z", now)).toBe(30);
    expect(tokenDaysLeft("2026-12-26T09:00:00.000Z", now)).toBe(29);
  });

  it("is zero on the last day and negative once expired", () => {
    expect(tokenDaysLeft("2026-11-26T20:00:00.000Z", now)).toBe(0);
    expect(tokenDaysLeft("2026-11-24T10:00:00.000Z", now)).toBe(-2);
    expect(tokenDaysLeft("2026-11-25T20:00:00.000Z", now)).toBe(-1);
  });
});

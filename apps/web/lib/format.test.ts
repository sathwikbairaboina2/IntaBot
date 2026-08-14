import { describe, expect, it } from "vitest";
import { formatSlot, summarise } from "./format";

describe("formatSlot", () => {
  it("renders an ISO instant as a readable local time", () => {
    expect(formatSlot("2026-08-20T09:00:00.000Z", "UTC")).toBe("20 Aug 2026, 09:00");
  });

  it("renders the instant in the given timezone", () => {
    // Berlin is UTC+2 in August.
    expect(formatSlot("2026-08-20T09:00:00.000Z", "Europe/Berlin")).toBe("20 Aug 2026, 11:00");
  });
});

describe("summarise", () => {
  it("truncates a long caption on a word boundary", () => {
    const long = "a".repeat(20) + " " + "b".repeat(200);
    expect(summarise(long, 30).length).toBeLessThanOrEqual(31);
    expect(summarise(long, 30).endsWith("…")).toBe(true);
  });

  it("leaves a short caption alone", () => {
    expect(summarise("Short.", 30)).toBe("Short.");
  });

  it("renders empty copy as a placeholder", () => {
    expect(summarise("", 30)).toBe("(no caption yet)");
  });
});

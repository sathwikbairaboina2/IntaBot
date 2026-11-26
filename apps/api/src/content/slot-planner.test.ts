import { describe, expect, it } from "vitest";
import { nextFreeSlot } from "./slot-planner";

const windows = ["09:00", "12:30", "18:00"];

describe("nextFreeSlot", () => {
  it("picks today's next window when there is enough lead time", () => {
    const slot = nextFreeSlot({
      now: new Date("2026-08-17T06:00:00.000Z"),
      timezone: "UTC",
      windows,
      takenAt: [],
    });
    expect(slot).toBe("2026-08-17T09:00:00.000Z");
  });

  it("skips a window that is inside the minimum lead time", () => {
    const slot = nextFreeSlot({
      now: new Date("2026-08-17T08:45:00.000Z"),
      timezone: "UTC",
      windows,
      takenAt: [],
    });
    expect(slot).toBe("2026-08-17T12:30:00.000Z");
  });

  it("rolls to the next day after the last window", () => {
    const slot = nextFreeSlot({
      now: new Date("2026-08-17T19:00:00.000Z"),
      timezone: "UTC",
      windows,
      takenAt: [],
    });
    expect(slot).toBe("2026-08-18T09:00:00.000Z");
  });

  it("skips a slot already taken", () => {
    const slot = nextFreeSlot({
      now: new Date("2026-08-17T06:00:00.000Z"),
      timezone: "UTC",
      windows,
      takenAt: ["2026-08-17T09:00:00.000Z"],
    });
    expect(slot).toBe("2026-08-17T12:30:00.000Z");
  });

  it("treats a slot within the collision window as taken", () => {
    const slot = nextFreeSlot({
      now: new Date("2026-08-17T06:00:00.000Z"),
      timezone: "UTC",
      windows,
      takenAt: ["2026-08-17T09:20:00.000Z"],
    });
    expect(slot).toBe("2026-08-17T12:30:00.000Z");
  });

  it("resolves windows in the account timezone, not UTC", () => {
    // Berlin is UTC+2 in August, so 09:00 local is 07:00Z.
    const slot = nextFreeSlot({
      now: new Date("2026-08-17T04:00:00.000Z"),
      timezone: "Europe/Berlin",
      windows,
      takenAt: [],
    });
    expect(slot).toBe("2026-08-17T07:00:00.000Z");
  });

  it("honours a single-window configuration across days", () => {
    const slot = nextFreeSlot({
      now: new Date("2026-08-17T06:00:00.000Z"),
      timezone: "UTC",
      windows: ["09:00"],
      takenAt: ["2026-08-17T09:00:00.000Z", "2026-08-18T09:00:00.000Z"],
    });
    expect(slot).toBe("2026-08-19T09:00:00.000Z");
  });

  it("throws when no free slot exists in the search horizon", () => {
    const taken = Array.from({ length: 30 }, (_, i) => {
      const day = String(17 + i).padStart(2, "0");
      return `2026-08-${day}T09:00:00.000Z`;
    });
    expect(() =>
      nextFreeSlot({
        now: new Date("2026-08-17T06:00:00.000Z"),
        timezone: "UTC",
        windows: ["09:00"],
        takenAt: taken,
        horizonDays: 5,
      }),
    ).toThrow(/no free slot/i);
  });

  describe("Asia/Kolkata (UTC+05:30, no daylight saving)", () => {
    const ist = (now: string, takenAt: string[] = []) =>
      nextFreeSlot({ now: new Date(now), timezone: "Asia/Kolkata", windows, takenAt });

    it("reads windows as local wall-clock times", () => {
      // 06:00Z is 11:30 IST, so 12:30 IST (07:00Z) is the next window.
      expect(ist("2026-11-26T06:00:00.000Z")).toBe("2026-11-26T07:00:00.000Z");
    });

    it("accepts a window exactly at the minimum lead time", () => {
      // 03:00Z = 08:30 IST; 09:00 IST = 03:30Z is exactly 30 minutes ahead.
      expect(ist("2026-11-26T03:00:00.000Z")).toBe("2026-11-26T03:30:00.000Z");
    });

    it("skips a window one second inside the lead time", () => {
      expect(ist("2026-11-26T03:00:01.000Z")).toBe("2026-11-26T07:00:00.000Z");
    });

    it("rolls to tomorrow 09:00 IST after the last window", () => {
      // 12:30Z = 18:00 IST on the 26th: nothing left today.
      expect(ist("2026-11-26T12:30:00.000Z")).toBe("2026-11-27T03:30:00.000Z");
    });

    it("uses the local date, not the UTC date, just after midnight IST", () => {
      // 19:00Z on the 26th is 00:30 IST on the 27th: 09:00 IST on the 27th.
      expect(ist("2026-11-26T19:00:00.000Z")).toBe("2026-11-27T03:30:00.000Z");
    });

    it("steps over a taken slot to the next window", () => {
      expect(ist("2026-11-26T06:00:00.000Z", ["2026-11-26T07:00:00.000Z"])).toBe(
        "2026-11-26T12:30:00.000Z",
      );
    });
  });
});

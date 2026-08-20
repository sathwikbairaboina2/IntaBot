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
});

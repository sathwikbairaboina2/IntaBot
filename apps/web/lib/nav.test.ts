import { describe, expect, it } from "vitest";
import { activeEntry, countLabel, isActive, menuButtonLabel, menuStaysOpen, navEntries, waitingTotal } from "./nav";

describe("isActive", () => {
  it("matches the home route only exactly", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/", "/approvals")).toBe(false);
  });
  it("matches a section and its children, not a name that merely starts the same", () => {
    expect(isActive("/approvals", "/approvals")).toBe(true);
    expect(isActive("/approvals", "/approvals/abc")).toBe(true);
    expect(isActive("/upload", "/uploads")).toBe(false);
  });
});

describe("navEntries", () => {
  it("lists the four screens with counts only where there is something to do", () => {
    const entries = navEntries({ approvals: 3, moderation: 0 });
    expect(entries.map((e) => e.label)).toEqual(["Accounts", "Approvals", "Upload", "Moderation"]);
    expect(entries.map((e) => e.count)).toEqual([null, 3, null, 0]);
  });
  it("treats a count that failed to load as none", () => {
    expect(navEntries({ approvals: null, moderation: null }).map((e) => e.count)).toEqual([null, 0, null, 0]);
  });
});

describe("activeEntry", () => {
  it("finds the entry for the path", () => {
    const entries = navEntries({ approvals: 0, moderation: 0 });
    expect(activeEntry(entries, "/moderation")?.label).toBe("Moderation");
    expect(activeEntry(entries, "/nowhere")).toBeUndefined();
  });
});

describe("countLabel", () => {
  it("is empty for zero, the number up to 99 and 99+ beyond", () => {
    expect(countLabel(0)).toBe("");
    expect(countLabel(7)).toBe("7");
    expect(countLabel(99)).toBe("99");
    expect(countLabel(100)).toBe("99+");
  });
});

describe("menuButtonLabel", () => {
  it("names the waiting items so a screen reader hears what the badge shows", () => {
    expect(menuButtonLabel({ approvals: 0, moderation: 0 })).toBe("Open menu");
    expect(menuButtonLabel({ approvals: 2, moderation: 1 })).toBe("Open menu, 3 waiting");
  });
});

describe("waitingTotal", () => {
  it("adds approvals and moderation and ignores failed counts", () => {
    expect(waitingTotal({ approvals: 2, moderation: 4 })).toBe(6);
    expect(waitingTotal({ approvals: null, moderation: 4 })).toBe(4);
  });
});

describe("menuStaysOpen", () => {
  it("closes on a route change and when the window grows past phone width", () => {
    expect(menuStaysOpen({ open: true, phone: true, from: "/", to: "/" })).toBe(true);
    expect(menuStaysOpen({ open: true, phone: true, from: "/", to: "/upload" })).toBe(false);
    expect(menuStaysOpen({ open: true, phone: false, from: "/", to: "/" })).toBe(false);
    expect(menuStaysOpen({ open: false, phone: true, from: "/", to: "/" })).toBe(false);
  });
});

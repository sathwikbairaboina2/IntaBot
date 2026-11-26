import { describe, expect, it } from "vitest";
import { IG, THEME_COOKIE, parseTheme } from "./theme";

describe("parseTheme", () => {
  it("returns dark only for the exact value 'dark'", () => {
    expect(parseTheme("dark")).toBe("dark");
  });

  it("falls back to light for anything else", () => {
    for (const value of [undefined, null, "", "light", "DARK", "blue"]) {
      expect(parseTheme(value)).toBe("light");
    }
  });
});

describe("theme constants", () => {
  it("uses the shared cookie name and Instagram's ground colours", () => {
    expect(THEME_COOKIE).toBe("intabot-theme");
    expect(IG.dark.ground).toBe("#000000");
    expect(IG.light.ground).toBe("#ffffff");
    expect(IG.dark.action).toBe("#e1306c");
    expect(IG.light.textSecondary).toBe("#5e5e5e");
  });
});

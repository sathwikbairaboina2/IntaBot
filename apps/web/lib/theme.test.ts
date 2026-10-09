import { describe, expect, it } from "vitest";
import { IG, THEME_COOKIE, parseTheme } from "./theme";

describe("parseTheme", () => {
  it("returns light only for the exact value 'light'", () => {
    expect(parseTheme("light")).toBe("light");
  });

  it("falls back to dark for anything else", () => {
    for (const value of [undefined, null, "", "dark", "LIGHT", "blue"]) {
      expect(parseTheme(value)).toBe("dark");
    }
  });
});

describe("theme constants", () => {
  it("uses the shared cookie name and Instagram's ground colours", () => {
    expect(THEME_COOKIE).toBe("intabot-theme");
    expect(IG.dark.ground).toBe("#000000");
    expect(IG.light.ground).toBe("#ffffff");
    expect(IG.dark.action).toBe("#e1306c");
  });
});

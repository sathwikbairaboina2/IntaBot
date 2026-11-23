import { describe, expect, it } from "vitest";
import { isLinkRequest } from "./link-request";

describe("isLinkRequest", () => {
  it.each(["LINK", "link pls", "Link!", "  link  ", "send me the LINK please", "🔥link🔥", "(link)", "link, thanks", "please.link"])(
    "matches %j",
    (text) => {
      expect(isLinkRequest(text, "LINK")).toBe(true);
    },
  );

  it.each(["linkedin?", "blink", "links", "relinked", "", "no keyword here", "unlink"])(
    "does not match %j",
    (text) => {
      expect(isLinkRequest(text, "LINK")).toBe(false);
    },
  );

  it("uses the account's own keyword, case-insensitively", () => {
    expect(isLinkRequest("Apply me", "apply")).toBe(true);
    expect(isLinkRequest("link", "APPLY")).toBe(false);
  });

  it("handles regex characters and a blank keyword safely", () => {
    expect(isLinkRequest("c++ job", "c++")).toBe(true);
    expect(isLinkRequest("anything", "")).toBe(false);
    expect(isLinkRequest("anything", "  ")).toBe(false);
  });
});

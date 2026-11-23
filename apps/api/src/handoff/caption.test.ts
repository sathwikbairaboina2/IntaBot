import { describe, expect, it } from "vitest";
import { HANDOFF_HASHTAGS, jobCaption } from "./caption";

describe("jobCaption", () => {
  it("fills the template exactly", () => {
    const caption = jobCaption({
      role: "Backend Engineer",
      company: "Acme",
      experience: "2-4 yrs",
      location: "Bengaluru",
      eligibility: "B.Tech 2022-2024",
      applyUrl: "https://aiiolar.com/jobs?job=acme-backend",
      keyword: "LINK",
    });
    expect(caption).toBe(
      [
        "Backend Engineer at Acme",
        "",
        "Experience: 2-4 yrs",
        "Location: Bengaluru",
        "Eligibility: B.Tech 2022-2024",
        "",
        "Apply: https://aiiolar.com/jobs?job=acme-backend",
        "Comment LINK and we'll DM you the link.",
      ].join("\n"),
    );
  });

  it("uses the account keyword", () => {
    const caption = jobCaption({
      role: "R",
      company: "C",
      experience: "e",
      location: "l",
      eligibility: "q",
      applyUrl: "https://x.test/",
      keyword: "APPLY",
    });
    expect(caption.endsWith("Comment APPLY and we'll DM you the link.")).toBe(true);
  });

  it("keeps the hashtags constant", () => {
    expect(HANDOFF_HASHTAGS).toEqual(["#hiring", "#jobs"]);
  });
});

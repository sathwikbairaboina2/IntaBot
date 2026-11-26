import { z } from "zod";

export const HANDOFF_HASHTAGS = ["#hiring", "#jobs"];

export interface JobCaptionInput {
  role: string;
  company: string;
  experience: string;
  location: string;
  eligibility: string;
  applyUrl: string;
  /** The account's linkKeyword: the word a commenter types to get the link by DM. */
  keyword: string;
}

/** The fixed caption for a job card; wording changes here, nowhere else. */
export function jobCaption(input: JobCaptionInput): string {
  return [
    `${input.role} at ${input.company}`,
    "",
    `Experience: ${input.experience}`,
    `Location: ${input.location}`,
    `Eligibility: ${input.eligibility}`,
    "",
    `Apply: ${input.applyUrl}`,
    `Comment ${input.keyword} and we'll DM you the link.`,
  ].join("\n");
}

/** A per-post comment word: 2-20 letters or digits, nothing else. */
export const HANDOFF_KEYWORD = z.string().regex(/^[A-Za-z0-9]{2,20}$/, "2-20 letters or digits");

export interface ContentCaptionInput {
  title: string;
  /** The post's keyword, or the account's linkKeyword when the card names none. */
  keyword: string;
}

/** Caption for carousel and reel handoffs that bring no caption of their own. */
export function contentCaption(input: ContentCaptionInput): string {
  return [input.title, "", `Comment ${input.keyword} and we'll DM you the link.`].join("\n");
}

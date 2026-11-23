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

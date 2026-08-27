/**
 * Prompts and JSON schemas for the three model roles, kept provider-neutral so
 * the Anthropic and Ollama adapters ask for exactly the same thing. A drift
 * between them would show up as a behaviour change when LLM_PROVIDER flips,
 * which is the one difference an operator would never think to look for.
 */
import type { PostFormat } from "@intabot/shared";

export interface DraftPromptInput {
  accountVoice: string;
  format: PostFormat;
  recentCaptions: string[];
  mediaMeta: { contentType: string };
}

export interface ClassifyPromptInput {
  commentText: string;
  postCaption: string;
  accountVoice: string;
}

export interface ReplyPromptInput {
  commentText: string;
  postCaption: string;
  classification: { intent: string; sentiment: string };
  /** Carried by callers but delivered in the system prompt, not this one. */
  accountVoice?: string;
}

export const DRAFT_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    altText: { type: "string" },
  },
  required: ["caption", "hashtags", "altText"],
  additionalProperties: false,
} as const;

export const CLASSIFICATION_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
    intent: { type: "string", enum: ["question", "praise", "complaint", "spam", "other"] },
    toxicity: { type: "number", minimum: 0, maximum: 1 },
    isSpam: { type: "boolean" },
    needsHuman: { type: "boolean" },
  },
  required: ["sentiment", "intent", "toxicity", "isSpam", "needsHuman"],
  additionalProperties: false,
} as const;

export const REPLY_OUTPUT_SCHEMA = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
  additionalProperties: false,
} as const;

export function buildDraftPrompt(input: DraftPromptInput): string {
  const recent = input.recentCaptions.length
    ? input.recentCaptions.map((c) => `- ${c}`).join("\n")
    : "- (none yet)";

  return [
    `Write an Instagram caption for a ${input.format}.`,
    ``,
    `Brand voice: ${input.accountVoice}`,
    `Media type: ${input.mediaMeta.contentType}`,
    ``,
    `Recent captions from this account. Do not repeat their phrasing, structure, or opening:`,
    recent,
    ``,
    `Return a caption, a short list of relevant hashtags, and alt text describing`,
    `the image for a screen reader. Keep the caption under 300 characters.`,
  ].join("\n");
}

export function buildClassifyPrompt(input: ClassifyPromptInput): string {
  return [
    `Classify this Instagram comment left on a business account's post.`,
    ``,
    `Post caption: ${input.postCaption}`,
    `Account voice: ${input.accountVoice}`,
    ``,
    `Comment: ${input.commentText}`,
    ``,
    `Mark needsHuman true for complaints, legal or safety topics, purchase`,
    `disputes, or anything a bot should not answer on a brand's behalf.`,
  ].join("\n");
}

export function buildReplyPrompt(input: ReplyPromptInput): string {
  return [
    `Write a short public reply (under 40 words) to this Instagram comment.`,
    ``,
    `Post caption: ${input.postCaption}`,
    `Comment: ${input.commentText}`,
    `Classified intent: ${input.classification.intent}, sentiment: ${input.classification.sentiment}`,
    ``,
    `Reply warmly, in the brand voice, without promising anything specific.`,
  ].join("\n");
}

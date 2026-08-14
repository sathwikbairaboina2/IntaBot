import Anthropic from "@anthropic-ai/sdk";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AppConfigService } from "../config/config.service";
import {
  CopyWriterRefusalError,
  type CopyWriterPort,
  type DraftInput,
  type DraftOutput,
} from "./copy-writer.port";

export const DEFAULT_MODEL = "claude-opus-5";

const DraftPayload = z.object({
  caption: z.string().min(1),
  hashtags: z.array(z.string()),
  altText: z.string().min(1),
});

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    altText: { type: "string" },
  },
  required: ["caption", "hashtags", "altText"],
  additionalProperties: false,
} as const;

export function buildDraftPrompt(input: DraftInput): string {
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

@Injectable()
export class AnthropicCopyWriter implements CopyWriterPort {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    @Inject(AppConfigService) clientOrConfig: AppConfigService | Anthropic,
    model: string = DEFAULT_MODEL,
  ) {
    if (clientOrConfig instanceof AppConfigService) {
      const apiKey = clientOrConfig.anthropicApiKey;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for AnthropicCopyWriter");
      this.client = new Anthropic({ apiKey });
    } else {
      this.client = clientOrConfig as Anthropic;
    }
    this.model = model;
  }

  async draft(input: DraftInput): Promise<DraftOutput> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      messages: [{ role: "user", content: buildDraftPrompt(input) }],
    } as never);

    const message = response as unknown as {
      stop_reason: string;
      stop_details?: { category?: string | null };
      content: Array<{ type: string; text?: string }>;
    };

    // Check stop_reason before reading content: a refusal returns HTTP 200
    // with an empty content array.
    if (message.stop_reason === "refusal") {
      throw new CopyWriterRefusalError(message.stop_details?.category ?? "unspecified");
    }

    const text = message.content.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("copy writer response contained no text block");

    return DraftPayload.parse(JSON.parse(text));
  }
}

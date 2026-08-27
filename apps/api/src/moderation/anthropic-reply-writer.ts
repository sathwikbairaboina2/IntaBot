import Anthropic from "@anthropic-ai/sdk";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AppConfigService } from "../config/config.service";
import { REPLY_OUTPUT_SCHEMA, buildReplyPrompt } from "../llm/prompts";
import type { ReplyInput, ReplyWriterPort } from "./reply-writer.port";
import { ReplyRefusalError } from "./reply-writer.port";

export const REPLY_MODEL = "claude-opus-5";

// Shared with the Ollama reply writer so both providers ask for the same thing.
export { buildReplyPrompt };

const ReplyPayload = z.object({ text: z.string().min(1) });

const OUTPUT_SCHEMA = REPLY_OUTPUT_SCHEMA;

@Injectable()
export class AnthropicReplyWriter implements ReplyWriterPort {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    @Inject(AppConfigService) clientOrConfig: AppConfigService | Anthropic,
    model: string = REPLY_MODEL,
  ) {
    if (clientOrConfig instanceof AppConfigService) {
      const apiKey = clientOrConfig.anthropicApiKey;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for AnthropicReplyWriter");
      this.client = new Anthropic({ apiKey });
    } else {
      this.client = clientOrConfig as Anthropic;
    }
    this.model = model;
  }

  async draftReply(input: ReplyInput): Promise<{ text: string }> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: `Brand voice: ${input.accountVoice}`,
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      messages: [{ role: "user", content: buildReplyPrompt(input) }],
    } as never);

    const message = response as unknown as {
      stop_reason: string;
      stop_details?: { category?: string | null };
      content: Array<{ type: string; text?: string }>;
    };

    if (message.stop_reason === "refusal") {
      throw new ReplyRefusalError(message.stop_details?.category ?? "unspecified");
    }

    const text = message.content.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("reply writer response contained no text block");

    return ReplyPayload.parse(JSON.parse(text));
  }
}

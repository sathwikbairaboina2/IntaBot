import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AppConfigService } from "../config/config.service";
import { OllamaClient, OllamaSchemaError } from "../llm/ollama.client";
import { REPLY_OUTPUT_SCHEMA, buildReplyPrompt } from "../llm/prompts";
import type { ReplyInput, ReplyWriterPort } from "./reply-writer.port";
import { ReplyRefusalError } from "./reply-writer.port";

const ReplyPayload = z.object({ text: z.string().min(1) });

/**
 * Local reply writer over Ollama. An unusable response becomes a
 * ReplyRefusalError, which the moderation processor already handles by moving
 * the comment to ESCALATED under rule `reply-refused` — so a local model that
 * cannot answer produces a human work item, never silence and never a
 * half-formed public reply.
 */
@Injectable()
export class OllamaReplyWriter implements ReplyWriterPort {
  private readonly client: OllamaClient;
  private readonly model: string;

  constructor(
    @Inject(AppConfigService) clientOrConfig: AppConfigService | OllamaClient,
    model?: string,
  ) {
    if (clientOrConfig instanceof AppConfigService) {
      this.client = new OllamaClient(clientOrConfig.ollama.baseUrl);
      this.model = model ?? clientOrConfig.ollama.model;
    } else {
      this.client = clientOrConfig;
      this.model = model ?? "qwen3.6:27b";
    }
  }

  async draftReply(input: ReplyInput): Promise<{ text: string }> {
    try {
      return await this.client.chatJson({
        model: this.model,
        system: `Brand voice: ${input.accountVoice}`,
        prompt: buildReplyPrompt(input),
        schema: REPLY_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        validate: (v) => ReplyPayload.parse(v),
      });
    } catch (err) {
      if (err instanceof OllamaSchemaError) {
        throw new ReplyRefusalError("local model produced no usable reply");
      }
      throw err;
    }
  }
}

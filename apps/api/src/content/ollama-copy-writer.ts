import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AppConfigService } from "../config/config.service";
import { OllamaClient, OllamaSchemaError } from "../llm/ollama.client";
import { DRAFT_OUTPUT_SCHEMA, buildDraftPrompt } from "../llm/prompts";
import {
  CopyWriterRefusalError,
  type CopyWriterPort,
  type DraftInput,
  type DraftOutput,
} from "./copy-writer.port";

const DraftPayload = z.object({
  caption: z.string().min(1),
  hashtags: z.array(z.string()),
  altText: z.string().min(1),
});

/**
 * Local copy writer over Ollama. A local model has no refusal channel, so the
 * only way it can decline is by failing to produce the shape — after the
 * client's retry that becomes a CopyWriterRefusalError, which is the existing
 * "a human writes this one" path rather than a job failure.
 */
@Injectable()
export class OllamaCopyWriter implements CopyWriterPort {
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

  async draft(input: DraftInput): Promise<DraftOutput> {
    try {
      return await this.client.chatJson({
        model: this.model,
        system: `You write Instagram captions. Brand voice: ${input.accountVoice}`,
        prompt: buildDraftPrompt(input),
        schema: DRAFT_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        validate: (v) => DraftPayload.parse(v),
      });
    } catch (err) {
      if (err instanceof OllamaSchemaError) {
        throw new CopyWriterRefusalError("local model produced no usable copy");
      }
      throw err;
    }
  }
}

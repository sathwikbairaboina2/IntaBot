import { Inject, Injectable } from "@nestjs/common";
import { Classification, ClassificationSchema } from "@intabot/shared";
import { AppConfigService } from "../config/config.service";
import { OllamaClient, OllamaSchemaError } from "../llm/ollama.client";
import { CLASSIFICATION_OUTPUT_SCHEMA, buildClassifyPrompt } from "../llm/prompts";
import { REFUSAL_CLASSIFICATION } from "./anthropic-comment-classifier";
import type { ClassifyInput, CommentClassifierPort } from "./comment-classifier.port";

/**
 * Local comment classifier over Ollama. A model that will not produce a
 * classification is exactly a comment that needs a human, so an unusable
 * response maps onto the same REFUSAL_CLASSIFICATION the Anthropic classifier
 * returns for a refusal — never onto a confident-looking default.
 */
@Injectable()
export class OllamaCommentClassifier implements CommentClassifierPort {
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
      this.model = model ?? "qwen3.8:27b";
    }
  }

  async classify(input: ClassifyInput): Promise<Classification> {
    try {
      return await this.client.chatJson({
        model: this.model,
        prompt: buildClassifyPrompt(input),
        schema: CLASSIFICATION_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        // Classification is a judgement, not prose: keep it near-deterministic.
        temperature: 0,
        validate: (v) => ClassificationSchema.parse(v),
      });
    } catch (err) {
      if (err instanceof OllamaSchemaError) return REFUSAL_CLASSIFICATION;
      throw err;
    }
  }
}

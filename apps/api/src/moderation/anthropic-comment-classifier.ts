import Anthropic from "@anthropic-ai/sdk";
import { Inject, Injectable } from "@nestjs/common";
import { Classification, ClassificationSchema } from "@intabot/shared";
import { AppConfigService } from "../config/config.service";
import { CLASSIFICATION_OUTPUT_SCHEMA, buildClassifyPrompt } from "../llm/prompts";
import type { ClassifyInput, CommentClassifierPort } from "./comment-classifier.port";

export const CLASSIFIER_MODEL = "claude-opus-5";

// Shared with the Ollama classifier so both providers ask for the same thing.
export { buildClassifyPrompt };

const OUTPUT_SCHEMA = CLASSIFICATION_OUTPUT_SCHEMA;

/** A refusal means the model would not touch the comment — which is exactly
 * the definition of a comment that needs a human. */
export const REFUSAL_CLASSIFICATION: Classification = {
  sentiment: "neutral",
  intent: "other",
  toxicity: 0,
  isSpam: false,
  needsHuman: true,
};

@Injectable()
export class AnthropicCommentClassifier implements CommentClassifierPort {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    @Inject(AppConfigService) clientOrConfig: AppConfigService | Anthropic,
    model: string = CLASSIFIER_MODEL,
  ) {
    if (clientOrConfig instanceof AppConfigService) {
      const apiKey = clientOrConfig.anthropicApiKey;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for AnthropicCommentClassifier");
      this.client = new Anthropic({ apiKey });
    } else {
      this.client = clientOrConfig as Anthropic;
    }
    this.model = model;
  }

  async classify(input: ClassifyInput): Promise<Classification> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      effort: "low",
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      messages: [{ role: "user", content: buildClassifyPrompt(input) }],
    } as never);

    const message = response as unknown as {
      stop_reason: string;
      content: Array<{ type: string; text?: string }>;
    };

    // Check stop_reason before reading content: a refusal returns HTTP 200
    // with an empty content array.
    if (message.stop_reason === "refusal") return REFUSAL_CLASSIFICATION;

    const text = message.content.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("classifier response contained no text block");

    return ClassificationSchema.parse(JSON.parse(text));
  }
}

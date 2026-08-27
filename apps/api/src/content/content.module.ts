import { Module } from "@nestjs/common";
import { AppConfigService } from "../config/config.service";
import { AnthropicCopyWriter } from "./anthropic-copy-writer";
import { COPY_WRITER } from "./copy-writer.port";
import { FakeCopyWriter } from "./fake-copy-writer";
import { OllamaCopyWriter } from "./ollama-copy-writer";

@Module({
  providers: [
    FakeCopyWriter,
    {
      provide: COPY_WRITER,
      inject: [AppConfigService, FakeCopyWriter],
      // The fake stays the default. LLM_PROVIDER opts in to a real writer, and
      // when it is unset a present ANTHROPIC_API_KEY still selects Anthropic,
      // exactly as before.
      useFactory: (config: AppConfigService, fake: FakeCopyWriter) => {
        if (config.llmProvider === "ollama") return new OllamaCopyWriter(config);
        if (config.llmProvider === "anthropic") return new AnthropicCopyWriter(config);
        return fake;
      },
    },
  ],
  exports: [COPY_WRITER, FakeCopyWriter],
})
export class ContentModule {}

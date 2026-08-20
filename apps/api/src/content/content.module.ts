import { Module } from "@nestjs/common";
import { AppConfigService } from "../config/config.service";
import { AnthropicCopyWriter } from "./anthropic-copy-writer";
import { COPY_WRITER } from "./copy-writer.port";
import { FakeCopyWriter } from "./fake-copy-writer";

@Module({
  providers: [
    FakeCopyWriter,
    {
      provide: COPY_WRITER,
      inject: [AppConfigService, FakeCopyWriter],
      // The fake is the default. A real key opts in to real generation, so
      // tests and a fresh checkout never need credentials.
      useFactory: (config: AppConfigService, fake: FakeCopyWriter) =>
        config.anthropicApiKey ? new AnthropicCopyWriter(config) : fake,
    },
  ],
  exports: [COPY_WRITER, FakeCopyWriter],
})
export class ContentModule {}

import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module";
import { AppConfigService } from "../config/config.service";
import { InstagramModule } from "../instagram/instagram.module";
import { ModerationController } from "./moderation.controller";
import { AnthropicCommentClassifier } from "./anthropic-comment-classifier";
import { AnthropicReplyWriter } from "./anthropic-reply-writer";
import { COMMENT_CLASSIFIER } from "./comment-classifier.port";
import { CommentRepository } from "./comment.repository";
import { FakeCommentClassifier } from "./fake-comment-classifier";
import { FakeReplyWriter } from "./fake-reply-writer";
import { IgMediaRefRepository } from "./ig-media-ref.repository";
import { OllamaCommentClassifier } from "./ollama-comment-classifier";
import { OllamaReplyWriter } from "./ollama-reply-writer";
import { REPLY_WRITER } from "./reply-writer.port";
import { ReplyCapService } from "./reply-cap.service";

@Module({
  imports: [AccountsModule, InstagramModule],
  controllers: [ModerationController],
  providers: [
    CommentRepository,
    IgMediaRefRepository,
    ReplyCapService,
    FakeCommentClassifier,
    FakeReplyWriter,
    {
      provide: COMMENT_CLASSIFIER,
      inject: [AppConfigService, FakeCommentClassifier],
      // The fake is the default. LLM_PROVIDER opts in to a real classifier, so
      // tests and a fresh checkout never need credentials or a local runtime.
      useFactory: (config: AppConfigService, fake: FakeCommentClassifier) => {
        if (config.llmProvider === "ollama") return new OllamaCommentClassifier(config);
        if (config.llmProvider === "anthropic") return new AnthropicCommentClassifier(config);
        return fake;
      },
    },
    {
      provide: REPLY_WRITER,
      inject: [AppConfigService, FakeReplyWriter],
      useFactory: (config: AppConfigService, fake: FakeReplyWriter) => {
        if (config.llmProvider === "ollama") return new OllamaReplyWriter(config);
        if (config.llmProvider === "anthropic") return new AnthropicReplyWriter(config);
        return fake;
      },
    },
  ],
  exports: [
    CommentRepository,
    IgMediaRefRepository,
    ReplyCapService,
    FakeCommentClassifier,
    FakeReplyWriter,
    COMMENT_CLASSIFIER,
    REPLY_WRITER,
  ],
})
export class ModerationModule {}

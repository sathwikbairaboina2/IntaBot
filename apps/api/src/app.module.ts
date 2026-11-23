import { Module } from "@nestjs/common";
import { AccountsModule } from "./accounts/accounts.module";
import { ApprovalsModule } from "./approvals/approvals.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { AppConfigModule } from "./config/config.module";
import { ContentModule } from "./content/content.module";
import { CryptoModule } from "./crypto/crypto.module";
import { DynamoModule } from "./dynamo/dynamo.module";
import { HandoffModule } from "./handoff/handoff.module";
import { HealthController } from "./health/health.controller";
import { InstagramModule } from "./instagram/instagram.module";
import { JobsModule } from "./jobs/jobs.module";
import { MediaModule } from "./media/media.module";
import { ModerationModule } from "./moderation/moderation.module";
import { PostsModule } from "./posts/posts.module";
import { WebhooksModule } from "./webhooks/webhooks.module";

@Module({
  imports: [
    AppConfigModule,
    DynamoModule,
    CryptoModule,
    AuditModule,
    AuthModule,
    AccountsModule,
    PostsModule,
    InstagramModule,
    JobsModule,
    MediaModule,
    ContentModule,
    ApprovalsModule,
    ModerationModule,
    WebhooksModule,
    HandoffModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

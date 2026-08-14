import { Module } from "@nestjs/common";
import { AccountsModule } from "./accounts/accounts.module";
import { AuthModule } from "./auth/auth.module";
import { AppConfigModule } from "./config/config.module";
import { ContentModule } from "./content/content.module";
import { CryptoModule } from "./crypto/crypto.module";
import { DynamoModule } from "./dynamo/dynamo.module";
import { HealthController } from "./health/health.controller";
import { InstagramModule } from "./instagram/instagram.module";
import { JobsModule } from "./jobs/jobs.module";
import { MediaModule } from "./media/media.module";
import { PostsModule } from "./posts/posts.module";

@Module({
  imports: [
    AppConfigModule,
    DynamoModule,
    CryptoModule,
    AuthModule,
    AccountsModule,
    PostsModule,
    InstagramModule,
    JobsModule,
    MediaModule,
    ContentModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

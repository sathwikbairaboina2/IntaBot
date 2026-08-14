import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { AppConfigModule } from "./config/config.module";
import { CryptoModule } from "./crypto/crypto.module";
import { DynamoModule } from "./dynamo/dynamo.module";
import { HealthController } from "./health/health.controller";
import { InstagramModule } from "./instagram/instagram.module";
import { PostsModule } from "./posts/posts.module";

@Module({
  imports: [
    AppConfigModule,
    DynamoModule,
    CryptoModule,
    AuthModule,
    PostsModule,
    InstagramModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

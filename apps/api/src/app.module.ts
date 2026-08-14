import { Module } from "@nestjs/common";
import { AppConfigModule } from "./config/config.module";
import { CryptoModule } from "./crypto/crypto.module";
import { DynamoModule } from "./dynamo/dynamo.module";
import { HealthController } from "./health/health.controller";
import { PostsModule } from "./posts/posts.module";

@Module({
  imports: [AppConfigModule, DynamoModule, CryptoModule, PostsModule],
  controllers: [HealthController],
})
export class AppModule {}

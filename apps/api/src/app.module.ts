import { Module } from "@nestjs/common";
import { AppConfigModule } from "./config/config.module";
import { CryptoModule } from "./crypto/crypto.module";
import { DynamoModule } from "./dynamo/dynamo.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [AppConfigModule, DynamoModule, CryptoModule],
  controllers: [HealthController],
})
export class AppModule {}

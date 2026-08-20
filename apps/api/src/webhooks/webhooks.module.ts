import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module";
import { WebhookSeenRepository } from "./webhook-seen.repository";
import { WebhooksController } from "./webhooks.controller";

@Module({
  imports: [AccountsModule],
  controllers: [WebhooksController],
  providers: [WebhookSeenRepository],
  exports: [WebhookSeenRepository],
})
export class WebhooksModule {}

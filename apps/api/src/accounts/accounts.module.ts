import { Module } from "@nestjs/common";
import { AccountRepository } from "./account.repository";
import { AccountsController } from "./accounts.controller";

@Module({
  controllers: [AccountsController],
  providers: [AccountRepository],
  exports: [AccountRepository],
})
export class AccountsModule {}

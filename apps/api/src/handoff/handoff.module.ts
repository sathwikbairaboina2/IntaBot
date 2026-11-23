import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module";
import { MediaModule } from "../media/media.module";
import { PostsModule } from "../posts/posts.module";
import { HandoffKeyGuard } from "./handoff-key.guard";
import { HandoffController } from "./handoff.controller";
import { HandoffRepository } from "./handoff.repository";

@Module({
  imports: [AccountsModule, PostsModule, MediaModule],
  controllers: [HandoffController],
  providers: [HandoffRepository, HandoffKeyGuard],
})
export class HandoffModule {}

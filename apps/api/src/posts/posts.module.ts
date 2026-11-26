import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module";
import { PostRepository } from "./post.repository";
import { PostsController } from "./posts.controller";

@Module({
  imports: [AccountsModule],
  controllers: [PostsController],
  providers: [PostRepository],
  exports: [PostRepository],
})
export class PostsModule {}

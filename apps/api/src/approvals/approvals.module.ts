import { Module } from "@nestjs/common";
import { PostsModule } from "../posts/posts.module";
import { ApprovalsController } from "./approvals.controller";

@Module({ imports: [PostsModule], controllers: [ApprovalsController] })
export class ApprovalsModule {}

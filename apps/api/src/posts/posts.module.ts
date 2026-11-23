import { Module } from "@nestjs/common";
import { PostRepository } from "./post.repository";
import { PostsController } from "./posts.controller";

@Module({ controllers: [PostsController], providers: [PostRepository], exports: [PostRepository] })
export class PostsModule {}

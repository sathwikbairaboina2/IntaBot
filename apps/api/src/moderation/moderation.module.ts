import { Module } from "@nestjs/common";
import { CommentRepository } from "./comment.repository";
import { IgMediaRefRepository } from "./ig-media-ref.repository";

@Module({
  providers: [CommentRepository, IgMediaRefRepository],
  exports: [CommentRepository, IgMediaRefRepository],
})
export class ModerationModule {}

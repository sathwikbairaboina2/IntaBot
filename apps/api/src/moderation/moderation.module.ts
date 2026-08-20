import { Module } from "@nestjs/common";
import { CommentRepository } from "./comment.repository";
import { IgMediaRefRepository } from "./ig-media-ref.repository";
import { ReplyCapService } from "./reply-cap.service";

@Module({
  providers: [CommentRepository, IgMediaRefRepository, ReplyCapService],
  exports: [CommentRepository, IgMediaRefRepository, ReplyCapService],
})
export class ModerationModule {}

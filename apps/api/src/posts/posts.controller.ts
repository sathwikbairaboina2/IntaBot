import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { PostStatus } from "@intabot/shared";
import { AuthGuard } from "../auth/auth.guard";
import { PostRepository } from "./post.repository";

@Controller("posts")
@UseGuards(AuthGuard)
export class PostsController {
  constructor(@Inject(PostRepository) private readonly posts: PostRepository) {}

  /** Posts of one account in one status, oldest slot first. */
  @Get()
  async list(@Query("accountId") accountId?: string, @Query("status") status?: string) {
    if (!accountId) throw new BadRequestException("accountId is required");
    const parsed = PostStatus.safeParse(status);
    if (!parsed.success) {
      throw new BadRequestException(`status must be one of ${PostStatus.options.join(", ")}`);
    }
    return this.posts.listByStatus(accountId, parsed.data);
  }
}

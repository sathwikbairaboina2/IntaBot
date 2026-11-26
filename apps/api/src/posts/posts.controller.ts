import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Post as PostModel, PostStatus } from "@intabot/shared";
import { AccountRepository } from "../accounts/account.repository";
import { AuditRepository } from "../audit/audit.repository";
import { PanelAuthGuard } from "../auth/panel-auth.guard";
import { PostRepository, PostTransitionConflictError } from "./post.repository";
import { PostView, canRetry, toPostView } from "./post-view";

@Controller("posts")
@UseGuards(PanelAuthGuard)
export class PostsController {
  constructor(
    @Inject(PostRepository) private readonly posts: PostRepository,
    @Inject(AccountRepository) private readonly accounts: AccountRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  /** Posts of one account in one status, oldest slot first. */
  @Get()
  async list(
    @Query("accountId") accountId?: string,
    @Query("status") status?: string,
  ): Promise<PostView[]> {
    if (!accountId) throw new BadRequestException("accountId is required");
    const parsed = PostStatus.safeParse(status);
    if (!parsed.success) {
      throw new BadRequestException(`status must be one of ${PostStatus.options.join(", ")}`);
    }
    return (await this.posts.listByStatus(accountId, parsed.data)).map(toPostView);
  }

  @Get(":id")
  async one(@Param("id") id: string, @Query("accountId") accountId?: string): Promise<PostView> {
    return toPostView(await this.find(id, accountId));
  }

  /** A failed post, or one stuck in PUBLISHING, goes back to the queue for now. */
  @Post(":id/retry")
  @HttpCode(200)
  async retry(
    @Param("id") id: string,
    @Query("accountId") queryAccountId?: string,
    @Body() body?: { accountId?: string },
  ): Promise<PostView> {
    const post = await this.find(id, queryAccountId ?? body?.accountId);
    if (!canRetry(post, new Date())) {
      throw new ConflictException(`post ${id} is ${post.status} and cannot be retried`);
    }

    let updated: PostModel;
    try {
      updated = await this.posts.transition({
        accountId: post.accountId,
        postId: post.id,
        expectedStatus: post.status,
        expectedVersion: post.version,
        nextStatus: "APPROVED",
        patch: { scheduledAt: new Date().toISOString() },
        clear: ["containerId", "childContainerIds", "failureReason"],
      });
    } catch (err) {
      if (err instanceof PostTransitionConflictError) throw new ConflictException(err.message);
      throw err;
    }
    await this.audit.append({
      accountId: post.accountId,
      actor: "human",
      action: "POST_RETRY",
      rule: `retry-from-${post.status.toLowerCase()}`,
      postId: post.id,
    });
    return toPostView(updated);
  }

  /** The panel may not know the account: with none named, look through them all. */
  private async find(id: string, accountId?: string): Promise<PostModel> {
    const candidates = accountId ? [accountId] : (await this.accounts.list()).map((a) => a.id);
    for (const candidate of candidates) {
      const post = await this.posts.get(candidate, id);
      if (post) return post;
    }
    throw new NotFoundException(`post not found: ${id}`);
  }
}

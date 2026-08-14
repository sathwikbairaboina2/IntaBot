import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { AuthGuard } from "../auth/auth.guard";
import { PostRepository, PostTransitionConflictError } from "../posts/post.repository";

const DecisionBody = z.object({
  accountId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative(),
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  scheduledAt: z.string().datetime().optional(),
});

@Controller("approvals")
@UseGuards(AuthGuard)
export class ApprovalsController {
  constructor(@Inject(PostRepository) private readonly posts: PostRepository) {}

  @Get()
  async list(@Query("accountId") accountId?: string) {
    if (!accountId) throw new BadRequestException("accountId is required");
    return this.posts.listByStatus(accountId, "PENDING_APPROVAL");
  }

  @Post(":id/approve")
  @HttpCode(200)
  async approve(@Param("id") id: string, @Body() body: unknown) {
    const parsed = DecisionBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const { accountId, expectedVersion, caption, hashtags, scheduledAt } = parsed.data;
    try {
      return await this.posts.transition({
        accountId,
        postId: id,
        expectedStatus: "PENDING_APPROVAL",
        expectedVersion,
        nextStatus: "APPROVED",
        patch: {
          ...(caption !== undefined ? { caption } : {}),
          ...(hashtags !== undefined ? { hashtags } : {}),
          ...(scheduledAt !== undefined ? { scheduledAt } : {}),
        },
      });
    } catch (err) {
      if (err instanceof PostTransitionConflictError) throw new ConflictException(err.message);
      throw err;
    }
  }

  @Post(":id/reject")
  @HttpCode(200)
  async reject(@Param("id") id: string, @Body() body: unknown) {
    const parsed = DecisionBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    try {
      return await this.posts.transition({
        accountId: parsed.data.accountId,
        postId: id,
        expectedStatus: "PENDING_APPROVAL",
        expectedVersion: parsed.data.expectedVersion,
        nextStatus: "REJECTED",
      });
    } catch (err) {
      if (err instanceof PostTransitionConflictError) throw new ConflictException(err.message);
      throw err;
    }
  }
}

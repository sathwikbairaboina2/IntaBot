import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CommentStatus } from "@intabot/shared";
import { z } from "zod";
import { PanelAuthGuard } from "../auth/panel-auth.guard";
import { CommentActionsService } from "./comment-actions.service";
import { CommentRepository } from "./comment.repository";
import { CommentView, toCommentView } from "./comment-view";

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

const PostId = z.string().min(1, "postId is required");
const TextBody = z.object({ postId: PostId.optional(), text: z.string().trim().min(1) });
const DmBody = z.object({ postId: PostId.optional(), text: z.string().trim().min(1).optional() });
const HideBody = z.object({ postId: PostId.optional(), hidden: z.boolean() });
const ListQuery = z.object({
  accountId: z.string().min(1, "accountId is required"),
  status: CommentStatus.optional(),
  since: z.string().datetime().optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(DEFAULT_PAGE),
});

export interface CommentList {
  items: CommentView[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

/**
 * Comment endpoints for the control room. A comment is addressed by its
 * Instagram id plus the post it belongs to (`postId`, in the body or query):
 * comments are stored per post, and the list endpoints return both.
 */
@Controller()
@UseGuards(PanelAuthGuard)
export class CommentsController {
  constructor(
    @Inject(CommentRepository) private readonly comments: CommentRepository,
    @Inject(CommentActionsService) private readonly actions: CommentActionsService,
  ) {}

  @Get("posts/:id/comments")
  async forPost(@Param("id") postId: string): Promise<CommentView[]> {
    return (await this.comments.listByPost(postId)).map(toCommentView);
  }

  @Get("comments")
  async recent(@Query() query: unknown): Promise<CommentList> {
    const parsed = ListQuery.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const { accountId, status, since, cursor, limit } = parsed.data;
    const page = await this.comments.listRecent(accountId, { status, since, before: cursor, limit });
    return { items: page.items.map(toCommentView), nextCursor: page.nextCursor };
  }

  @Post("comments/:id/reply")
  @HttpCode(200)
  async reply(
    @Param("id") id: string,
    @Body() body: unknown,
    @Query("postId") queryPostId?: string,
  ): Promise<CommentView> {
    const { postId, text } = this.parseText(body, queryPostId);
    return toCommentView(await this.actions.reply(postId, id, text));
  }

  @Post("comments/:id/dm")
  @HttpCode(200)
  async dm(
    @Param("id") id: string,
    @Body() body: unknown,
    @Query("postId") queryPostId?: string,
  ): Promise<CommentView> {
    const parsed = DmBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const postId = this.resolvePostId(parsed.data.postId, queryPostId);
    // No text resends the DM that failed earlier.
    return toCommentView(await this.actions.dm(postId, id, parsed.data.text));
  }

  @Post("comments/:id/hide")
  @HttpCode(200)
  async hide(
    @Param("id") id: string,
    @Body() body: unknown,
    @Query("postId") queryPostId?: string,
  ): Promise<CommentView> {
    const parsed = HideBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const postId = this.resolvePostId(parsed.data.postId, queryPostId);
    return toCommentView(await this.actions.hide(postId, id, parsed.data.hidden));
  }

  @Delete("comments/:id")
  async remove(@Param("id") id: string, @Query("postId") queryPostId?: string): Promise<CommentView> {
    return toCommentView(await this.actions.remove(this.resolvePostId(undefined, queryPostId), id));
  }

  private parseText(body: unknown, queryPostId: string | undefined) {
    const parsed = TextBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return { postId: this.resolvePostId(parsed.data.postId, queryPostId), text: parsed.data.text };
  }

  private resolvePostId(fromBody: string | undefined, fromQuery: string | undefined): string {
    const parsed = PostId.safeParse(fromBody ?? fromQuery);
    if (!parsed.success) throw new BadRequestException("postId is required");
    return parsed.data;
  }
}

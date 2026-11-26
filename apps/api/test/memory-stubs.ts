// In-memory stand-ins for the Dynamo repositories, so processor and service
// logic can be unit-tested without DynamoDB Local or Redis. Transitions keep
// the real repositories' conditional semantics.
import {
  Account,
  AccountSchema,
  Comment,
  CommentSchema,
  CommentStatus,
  Post,
  PostSchema,
  PostStatus,
} from "@intabot/shared";
import { ulid } from "ulid";
import { CommentTransitionConflictError } from "../src/moderation/comment.repository";
import type {
  CommentPatch,
  CommentTransitionArgs,
  CreateCommentInput,
} from "../src/moderation/comment.repository";
import { pageComments } from "../src/moderation/comment-page";
import type { CommentPageOptions } from "../src/moderation/comment-page";
import { PostTransitionConflictError } from "../src/posts/post.repository";
import type { CreatePostInput, TransitionArgs } from "../src/posts/post.repository";

export function makeAccount(overrides: Record<string, unknown> = {}): Account {
  return AccountSchema.parse({
    id: "acct-1",
    name: "Studio Nord",
    igUserId: "1784140",
    username: "studionord",
    status: "ACTIVE",
    accessTokenEncrypted: "v1:a:b:c",
    tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
    ...overrides,
  });
}

export class MemoryAccounts {
  constructor(private readonly items: Account[]) {}
  async get(id: string) {
    return this.items.find((a) => a.id === id) ?? null;
  }
  async list() {
    return [...this.items];
  }
  async update(id: string, patch: Partial<Account>) {
    const index = this.items.findIndex((a) => a.id === id);
    this.items[index] = { ...this.items[index]!, ...patch };
    return this.items[index]!;
  }
}

export class MemoryPosts {
  readonly items = new Map<string, Post>();

  seed(overrides: Partial<Post> & { id: string }): Post {
    const now = new Date().toISOString();
    const post = PostSchema.parse({
      accountId: "acct-1",
      status: "APPROVED",
      format: "IMAGE",
      version: 1,
      mediaAssetIds: ["asset-1"],
      caption: "caption",
      hashtags: [],
      scheduledAt: now,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
    this.items.set(post.id, post);
    return post;
  }

  async create(input: CreatePostInput): Promise<Post> {
    return this.seed({ ...input, id: ulid(), status: "DRAFT" });
  }

  async get(accountId: string, postId: string) {
    const post = this.items.get(postId);
    return post && post.accountId === accountId ? post : null;
  }

  async listByStatus(accountId: string, status: PostStatus) {
    return [...this.items.values()].filter((p) => p.accountId === accountId && p.status === status);
  }

  async transition(args: TransitionArgs): Promise<Post> {
    const post = this.items.get(args.postId);
    if (
      !post ||
      post.accountId !== args.accountId ||
      post.status !== args.expectedStatus ||
      post.version !== args.expectedVersion
    ) {
      throw new PostTransitionConflictError(args.postId, args.expectedStatus, args.expectedVersion);
    }
    const next: Record<string, unknown> = {
      ...post,
      ...args.patch,
      status: args.nextStatus,
      version: post.version + 1,
      updatedAt: new Date().toISOString(),
    };
    for (const field of args.clear ?? []) delete next[field];
    const parsed = PostSchema.parse(next);
    this.items.set(parsed.id, parsed);
    return parsed;
  }
}

export class MemoryComments {
  readonly items = new Map<string, Comment>();
  private tick = 0;
  private readonly base = Date.now();

  private key(postId: string, igCommentId: string) {
    return `${postId}|${igCommentId}`;
  }

  async create(input: CreateCommentInput): Promise<Comment | null> {
    const key = this.key(input.postId, input.igCommentId);
    if (this.items.has(key)) return null;
    // Distinct, ordered timestamps: the cursor pages on createdAt. Anchored at
    // the present so the 7-day private-reply window sees a fresh comment.
    const at = new Date(this.base + this.tick++).toISOString();
    const comment = CommentSchema.parse({
      ...input,
      status: "RECEIVED",
      version: 1,
      createdAt: at,
      updatedAt: at,
    });
    this.items.set(key, comment);
    return comment;
  }

  async get(postId: string, igCommentId: string) {
    return this.items.get(this.key(postId, igCommentId)) ?? null;
  }

  async listByPost(postId: string) {
    return [...this.items.values()]
      .filter((c) => c.postId === postId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listRecent(accountId: string, opts: CommentPageOptions & { status?: CommentStatus }) {
    const mine = [...this.items.values()].filter(
      (c) => c.accountId === accountId && (!opts.status || c.status === opts.status),
    );
    return pageComments(mine, opts);
  }

  async transition(args: CommentTransitionArgs): Promise<Comment> {
    const key = this.key(args.postId, args.igCommentId);
    const comment = this.items.get(key);
    if (
      !comment ||
      comment.status !== args.expectedStatus ||
      comment.version !== args.expectedVersion
    ) {
      throw new CommentTransitionConflictError(
        args.igCommentId,
        args.expectedStatus,
        args.expectedVersion,
      );
    }
    const patch: CommentPatch = args.patch ?? {};
    const next = CommentSchema.parse({
      ...comment,
      ...patch,
      status: args.nextStatus,
      version: comment.version + 1,
      updatedAt: new Date().toISOString(),
    });
    this.items.set(key, next);
    return next;
  }
}

export class MemoryAudit {
  readonly entries: Array<Record<string, unknown>> = [];
  async append(entry: Record<string, unknown>) {
    this.entries.push(entry);
  }
}

export class MemoryCaps {
  postCapReached = false;
  accountCapReached = false;
  increments = 0;
  async check() {
    return { postCapReached: this.postCapReached, accountCapReached: this.accountCapReached };
  }
  async increment() {
    this.increments += 1;
  }
}

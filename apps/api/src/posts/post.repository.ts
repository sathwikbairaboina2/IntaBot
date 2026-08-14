import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { Inject, Injectable } from "@nestjs/common";
import { Post, PostFormat, PostSchema, PostStatus } from "@intabot/shared";
import { ulid } from "ulid";
import { AppConfigService } from "../config/config.service";
import { DYNAMO_DOC } from "../dynamo/dynamo.module";
import { keys } from "../dynamo/keys";

export class PostTransitionConflictError extends Error {
  constructor(postId: string, expectedStatus: PostStatus, expectedVersion: number) {
    super(`post ${postId} is not at ${expectedStatus}@v${expectedVersion}`);
  }
}

export interface CreatePostInput {
  accountId: string;
  format: PostFormat;
  mediaAssetIds: string[];
  caption: string;
  hashtags: string[];
  scheduledAt: string;
}

export type PostPatch = Partial<
  Pick<
    Post,
    | "caption"
    | "hashtags"
    | "scheduledAt"
    | "containerId"
    | "igMediaId"
    | "permalink"
    | "failureReason"
    | "altText"
    | "needsAttention"
    | "dryRun"
  >
>;

export interface TransitionArgs {
  accountId: string;
  postId: string;
  expectedStatus: PostStatus;
  expectedVersion: number;
  nextStatus: PostStatus;
  patch?: PostPatch;
}

@Injectable()
export class PostRepository {
  private readonly table: string;

  constructor(
    @Inject(DYNAMO_DOC) private readonly doc: DynamoDBDocumentClient,
    @Inject(AppConfigService) tableOrConfig: AppConfigService | string,
  ) {
    this.table = typeof tableOrConfig === "string" ? tableOrConfig : tableOrConfig.dynamo.tableMain;
  }

  async create(input: CreatePostInput): Promise<Post> {
    const now = new Date().toISOString();
    const post = PostSchema.parse({
      id: ulid(),
      accountId: input.accountId,
      status: "DRAFT",
      format: input.format,
      version: 1,
      mediaAssetIds: input.mediaAssetIds,
      caption: input.caption,
      hashtags: input.hashtags,
      scheduledAt: input.scheduledAt,
      createdAt: now,
      updatedAt: now,
    });

    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          ...keys.post(post.accountId, post.id),
          ...keys.postStatusIndex(post.accountId, post.status, post.scheduledAt),
          ...post,
        },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      }),
    );
    return post;
  }

  async get(accountId: string, postId: string): Promise<Post | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: keys.post(accountId, postId) }),
    );
    return out.Item ? PostSchema.parse(out.Item) : null;
  }

  async listByStatus(accountId: string, status: PostStatus): Promise<Post[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `ACCT#${accountId}#ST#${status}` },
        ScanIndexForward: true,
      }),
    );
    return (out.Items ?? []).map((item) => PostSchema.parse(item));
  }

  /**
   * Conditional status transition. The condition is what makes a retried
   * publish job a no-op instead of a second Instagram container: if another
   * worker already moved the post, the current status/version no longer match
   * and this throws PostTransitionConflictError.
   */
  async transition(args: TransitionArgs): Promise<Post> {
    const { accountId, postId, expectedStatus, expectedVersion, nextStatus, patch = {} } = args;

    const scheduledAt = patch.scheduledAt;
    const setParts = [
      "#status = :nextStatus",
      "#version = :nextVersion",
      "#updatedAt = :updatedAt",
      "#GSI1PK = :GSI1PK",
    ];
    const names: Record<string, string> = {
      "#status": "status",
      "#version": "version",
      "#updatedAt": "updatedAt",
      "#GSI1PK": "GSI1PK",
    };
    const values: Record<string, unknown> = {
      ":nextStatus": nextStatus,
      ":nextVersion": expectedVersion + 1,
      ":updatedAt": new Date().toISOString(),
      ":GSI1PK": `ACCT#${accountId}#ST#${nextStatus}`,
      ":expectedStatus": expectedStatus,
      ":expectedVersion": expectedVersion,
    };

    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      setParts.push(`#${field} = :${field}`);
      names[`#${field}`] = field;
      values[`:${field}`] = value;
    }

    if (scheduledAt !== undefined) {
      setParts.push("#GSI1SK = :GSI1SK");
      names["#GSI1SK"] = "GSI1SK";
      values[":GSI1SK"] = scheduledAt;
    }

    try {
      const out = await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: keys.post(accountId, postId),
          UpdateExpression: `SET ${setParts.join(", ")}`,
          ConditionExpression:
            "attribute_exists(PK) AND #status = :expectedStatus AND #version = :expectedVersion",
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: "ALL_NEW",
        }),
      );
      return PostSchema.parse(out.Attributes);
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new PostTransitionConflictError(postId, expectedStatus, expectedVersion);
      }
      throw err;
    }
  }

  /** APPROVED posts whose slot has arrived. */
  async listDue(accountId: string, beforeIso: string): Promise<Post[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk AND GSI1SK <= :before",
        ExpressionAttributeValues: {
          ":pk": `ACCT#${accountId}#ST#APPROVED`,
          ":before": beforeIso,
        },
        ScanIndexForward: true,
      }),
    );
    return (out.Items ?? []).map((item) => PostSchema.parse(item));
  }

  /**
   * Scheduled instants for posts that still occupy a slot: anything awaiting
   * approval or already approved. Published and failed posts free their slot.
   */
  async listScheduledAfter(accountId: string, fromIso: string): Promise<string[]> {
    const statuses: PostStatus[] = ["PENDING_APPROVAL", "APPROVED"];
    const results: string[] = [];

    for (const status of statuses) {
      const out = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :pk AND GSI1SK >= :from",
          ExpressionAttributeValues: {
            ":pk": `ACCT#${accountId}#ST#${status}`,
            ":from": fromIso,
          },
        }),
      );
      for (const item of out.Items ?? []) {
        results.push(PostSchema.parse(item).scheduledAt);
      }
    }
    return results;
  }
}

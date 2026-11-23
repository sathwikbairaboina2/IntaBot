import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { Inject, Injectable } from "@nestjs/common";
import { Comment, CommentSchema, CommentStatus } from "@intabot/shared";
import { AppConfigService } from "../config/config.service";
import { DYNAMO_DOC } from "../dynamo/dynamo.module";
import { keys } from "../dynamo/keys";

export class CommentTransitionConflictError extends Error {
  constructor(igCommentId: string, expectedStatus: CommentStatus, expectedVersion: number) {
    super(`comment ${igCommentId} is not at ${expectedStatus}@v${expectedVersion}`);
  }
}

export interface CreateCommentInput {
  igCommentId: string;
  accountId: string;
  postId: string;
  igMediaId: string;
  text: string;
  fromIgUserId: string;
  fromUsername: string;
}

export type CommentPatch = Partial<
  Pick<Comment, "classification" | "policyRule" | "replyText" | "replyId" | "dmText" | "dmId">
>;

export interface CommentTransitionArgs {
  postId: string;
  igCommentId: string;
  accountId: string;
  expectedStatus: CommentStatus;
  expectedVersion: number;
  nextStatus: CommentStatus;
  patch?: CommentPatch;
}

@Injectable()
export class CommentRepository {
  private readonly table: string;

  constructor(
    @Inject(DYNAMO_DOC) private readonly doc: DynamoDBDocumentClient,
    @Inject(AppConfigService) tableOrConfig: AppConfigService | string,
  ) {
    this.table = typeof tableOrConfig === "string" ? tableOrConfig : tableOrConfig.dynamo.tableMain;
  }

  /**
   * Conditional create. Returns null when the comment already exists — the
   * second dedupe layer behind WebhookSeen, so a redelivered event that
   * outlives the 7-day TTL still cannot restart moderation.
   */
  async create(input: CreateCommentInput): Promise<Comment | null> {
    const now = new Date().toISOString();
    const comment = CommentSchema.parse({
      ...input,
      status: "RECEIVED",
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            ...keys.comment(comment.postId, comment.igCommentId),
            ...keys.commentStatusIndex(comment.accountId, comment.status, comment.createdAt),
            ...comment,
          },
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }),
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return null;
      throw err;
    }
    return comment;
  }

  async get(postId: string, igCommentId: string): Promise<Comment | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: keys.comment(postId, igCommentId) }),
    );
    return out.Item ? CommentSchema.parse(out.Item) : null;
  }

  async listByStatus(
    accountId: string,
    status: CommentStatus,
    opts: { limit?: number; newestFirst?: boolean } = {},
  ): Promise<Comment[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `ACCT#${accountId}#CST#${status}` },
        ScanIndexForward: !opts.newestFirst,
        ...(opts.limit !== undefined ? { Limit: opts.limit } : {}),
      }),
    );
    return (out.Items ?? []).map((item) => CommentSchema.parse(item));
  }

  /**
   * Conditional status transition, mirroring PostRepository. The claim before
   * replyToComment is what makes a duplicated moderation job reply at most
   * once.
   */
  async transition(args: CommentTransitionArgs): Promise<Comment> {
    const { postId, igCommentId, accountId, expectedStatus, expectedVersion, nextStatus } = args;
    const patch = args.patch ?? {};

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
      ":GSI1PK": `ACCT#${accountId}#CST#${nextStatus}`,
      ":expectedStatus": expectedStatus,
      ":expectedVersion": expectedVersion,
    };

    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      setParts.push(`#${field} = :${field}`);
      names[`#${field}`] = field;
      values[`:${field}`] = value;
    }

    try {
      const out = await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: keys.comment(postId, igCommentId),
          UpdateExpression: `SET ${setParts.join(", ")}`,
          ConditionExpression:
            "attribute_exists(PK) AND #status = :expectedStatus AND #version = :expectedVersion",
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: "ALL_NEW",
        }),
      );
      return CommentSchema.parse(out.Attributes);
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new CommentTransitionConflictError(igCommentId, expectedStatus, expectedVersion);
      }
      throw err;
    }
  }
}

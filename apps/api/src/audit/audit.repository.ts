import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { Inject, Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import { AppConfigService } from "../config/config.service";
import { DYNAMO_DOC } from "../dynamo/dynamo.module";
import { keys } from "../dynamo/keys";

const TTL_DAYS = 90;

export interface AuditEntry {
  accountId: string;
  actor: "agent" | "human" | "system";
  action: string;
  rule?: string;
  igCommentId?: string;
  postId?: string;
  classificationSummary?: string;
  dryRun?: boolean;
}

/**
 * Append-only decision log. Every moderation outcome — automatic or human —
 * lands here, so "why did the bot do that" is always answerable. Rows expire
 * via DynamoDB TTL after 90 days. Read API arrives with the Phase 5 audit UI;
 * list() exists for tests.
 */
@Injectable()
export class AuditRepository {
  private readonly table: string;

  constructor(
    @Inject(DYNAMO_DOC) private readonly doc: DynamoDBDocumentClient,
    @Inject(AppConfigService) tableOrConfig: AppConfigService | string,
  ) {
    this.table = typeof tableOrConfig === "string" ? tableOrConfig : tableOrConfig.dynamo.tableMain;
  }

  async append(entry: AuditEntry): Promise<void> {
    const now = new Date();
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          ...keys.auditLog(entry.accountId, `${now.toISOString()}#${ulid()}`),
          ...entry,
          createdAt: now.toISOString(),
          ttl: Math.floor(now.getTime() / 1000) + TTL_DAYS * 24 * 3600,
        },
      }),
    );
  }

  async list(accountId: string): Promise<Record<string, unknown>[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `ACCT#${accountId}#LOG` },
        ScanIndexForward: true,
      }),
    );
    return (out.Items ?? []) as Record<string, unknown>[];
  }
}

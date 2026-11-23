import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { Inject, Injectable } from "@nestjs/common";
import { AppConfigService } from "../config/config.service";
import { DYNAMO_DOC } from "../dynamo/dynamo.module";
import { keys } from "../dynamo/keys";

export interface HandoffClaim {
  accountId: string;
  postId: string;
}

export type ClaimResult = { won: true } | { won: false; existing: HandoffClaim };

/** Remembers which post a Studio card became, so a resend never duplicates it. */
@Injectable()
export class HandoffRepository {
  private readonly table: string;

  constructor(
    @Inject(DYNAMO_DOC) private readonly doc: DynamoDBDocumentClient,
    @Inject(AppConfigService) tableOrConfig: AppConfigService | string,
  ) {
    this.table = typeof tableOrConfig === "string" ? tableOrConfig : tableOrConfig.dynamo.tableMain;
  }

  async find(cardId: string): Promise<HandoffClaim | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: keys.handoff(cardId) }),
    );
    if (!out.Item) return null;
    return { accountId: out.Item.accountId as string, postId: out.Item.postId as string };
  }

  /** Conditional put. Returns the winning claim when another request got there first. */
  async claim(cardId: string, claim: HandoffClaim): Promise<ClaimResult> {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: { ...keys.handoff(cardId), ...claim, createdAt: new Date().toISOString() },
          ConditionExpression: "attribute_not_exists(PK)",
        }),
      );
      return { won: true };
    } catch (err) {
      if (!(err instanceof ConditionalCheckFailedException)) throw err;
      const existing = await this.find(cardId);
      if (!existing) throw err;
      return { won: false, existing };
    }
  }
}

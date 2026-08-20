import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { Inject, Injectable } from "@nestjs/common";
import { AppConfigService } from "../config/config.service";
import { DYNAMO_DOC } from "../dynamo/dynamo.module";
import { keys } from "../dynamo/keys";

export interface IgMediaRef {
  accountId: string;
  postId: string;
}

/**
 * Webhooks carry an ig media id, not a post ULID. Publish writes one inverse
 * item per published media so the moderation worker resolves the owning post
 * with a single GetItem. A miss means the comment is on media IntaBot did not
 * publish, which is out of scope.
 */
@Injectable()
export class IgMediaRefRepository {
  private readonly table: string;

  constructor(
    @Inject(DYNAMO_DOC) private readonly doc: DynamoDBDocumentClient,
    @Inject(AppConfigService) tableOrConfig: AppConfigService | string,
  ) {
    this.table = typeof tableOrConfig === "string" ? tableOrConfig : tableOrConfig.dynamo.tableMain;
  }

  async put(igMediaId: string, ref: IgMediaRef): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { ...keys.igMediaRef(igMediaId), ...ref },
      }),
    );
  }

  async get(igMediaId: string): Promise<IgMediaRef | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: keys.igMediaRef(igMediaId) }),
    );
    if (!out.Item) return null;
    return { accountId: out.Item.accountId as string, postId: out.Item.postId as string };
  }
}

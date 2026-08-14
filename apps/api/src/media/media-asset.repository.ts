import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { Inject, Injectable } from "@nestjs/common";
import { MediaAsset, MediaAssetSchema } from "@intabot/shared";
import { ulid } from "ulid";
import { AppConfigService } from "../config/config.service";
import { DYNAMO_DOC } from "../dynamo/dynamo.module";
import { keys } from "../dynamo/keys";

export interface CreateMediaAssetInput {
  accountId: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  widthPx?: number;
  heightPx?: number;
  durationSeconds?: number;
}

@Injectable()
export class MediaAssetRepository {
  private readonly table: string;

  constructor(
    @Inject(DYNAMO_DOC) private readonly doc: DynamoDBDocumentClient,
    @Inject(AppConfigService) tableOrConfig: AppConfigService | string,
  ) {
    this.table = typeof tableOrConfig === "string" ? tableOrConfig : tableOrConfig.dynamo.tableMain;
  }

  async create(input: CreateMediaAssetInput): Promise<MediaAsset> {
    const asset = MediaAssetSchema.parse({
      id: ulid(),
      ...input,
      createdAt: new Date().toISOString(),
    });
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { ...keys.mediaAsset(asset.accountId, asset.id), ...asset },
      }),
    );
    return asset;
  }

  async get(accountId: string, assetId: string): Promise<MediaAsset | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: keys.mediaAsset(accountId, assetId) }),
    );
    return out.Item ? MediaAssetSchema.parse(out.Item) : null;
  }

  async markDraftFailed(accountId: string, assetId: string): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: keys.mediaAsset(accountId, assetId),
        UpdateExpression: "SET #draftFailed = :true",
        ExpressionAttributeNames: { "#draftFailed": "draftFailed" },
        ExpressionAttributeValues: { ":true": true },
      }),
    );
  }
}

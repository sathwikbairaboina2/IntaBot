import { createHash, randomBytes } from "node:crypto";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { Inject, Injectable } from "@nestjs/common";
import { AppConfigService } from "../config/config.service";
import { DYNAMO_DOC } from "../dynamo/dynamo.module";
import { keys } from "../dynamo/keys";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class SessionService {
  private readonly table: string;
  private readonly ttlHours: number;

  constructor(
    @Inject(DYNAMO_DOC) private readonly doc: DynamoDBDocumentClient,
    @Inject(AppConfigService) tableOrConfig: AppConfigService | string,
    ttlHours?: number,
  ) {
    if (typeof tableOrConfig === "string") {
      this.table = tableOrConfig;
      this.ttlHours = ttlHours ?? 168;
    } else {
      this.table = tableOrConfig.dynamo.tableMain;
      this.ttlHours = tableOrConfig.session.ttlHours;
    }
  }

  async create(email: string): Promise<{ token: string; expiresAt: string }> {
    const token = randomBytes(32).toString("hex");
    const expiresAtMs = Date.now() + this.ttlHours * 3_600_000;
    const expiresAt = new Date(expiresAtMs).toISOString();

    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          ...keys.session(hashToken(token)),
          email: email.toLowerCase(),
          expiresAt,
          // DynamoDB TTL attribute - seconds since epoch.
          ttl: Math.floor(expiresAtMs / 1000),
        },
      }),
    );
    return { token, expiresAt };
  }

  async verify(token: string): Promise<string | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: keys.session(hashToken(token)) }),
    );
    if (!out.Item) return null;

    const expiresAt = out.Item["expiresAt"] as string | undefined;
    if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) return null;

    return (out.Item["email"] as string) ?? null;
  }

  async revoke(token: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({ TableName: this.table, Key: keys.session(hashToken(token)) }),
    );
  }
}

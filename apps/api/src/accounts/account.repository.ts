import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { Inject, Injectable } from "@nestjs/common";
import { Account, AccountSchema } from "@intabot/shared";
import { ulid } from "ulid";
import { AppConfigService } from "../config/config.service";
import { DYNAMO_DOC } from "../dynamo/dynamo.module";
import { keys } from "../dynamo/keys";

export class AccountAlreadyExistsError extends Error {
  constructor(id: string) {
    super(`account already exists: ${id}`);
  }
}

export class AccountNotFoundError extends Error {
  constructor(id: string) {
    super(`account not found: ${id}`);
  }
}

export interface CreateAccountInput {
  id?: string;
  name: string;
  igUserId: string;
  username: string;
  accessTokenEncrypted: string;
  tokenExpiresAt: string;
  /** IANA zone; omitted keeps the schema default. */
  timezone?: string;
}

export type UpdateAccountPatch = Partial<
  Pick<
    Account,
    | "name"
    | "status"
    | "dryRun"
    | "moderationPaused"
    | "accessTokenEncrypted"
    | "tokenExpiresAt"
    | "replyCapPerPostPerHour"
    | "replyCapPerAccountPerHour"
    | "blocklist"
    | "linkKeyword"
    | "listKeyword"
    | "listText"
    | "timezone"
    | "postingWindows"
    | "tokenRefreshError"
    | "tokenRefreshedAt"
  >
>;

@Injectable()
export class AccountRepository {
  private readonly table: string;

  constructor(
    @Inject(DYNAMO_DOC) private readonly doc: DynamoDBDocumentClient,
    @Inject(AppConfigService) tableOrConfig: AppConfigService | string,
  ) {
    this.table = typeof tableOrConfig === "string" ? tableOrConfig : tableOrConfig.dynamo.tableMain;
  }

  async create(input: CreateAccountInput): Promise<Account> {
    const now = new Date().toISOString();
    const account = AccountSchema.parse({
      id: input.id ?? ulid(),
      name: input.name,
      igUserId: input.igUserId,
      username: input.username,
      status: "ACTIVE",
      accessTokenEncrypted: input.accessTokenEncrypted,
      tokenExpiresAt: input.tokenExpiresAt,
      dryRun: true,
      moderationPaused: false,
      ...(input.timezone ? { timezone: input.timezone } : {}),
      createdAt: now,
      updatedAt: now,
    });

    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            ...keys.account(account.id),
            ...keys.accountListIndex(account.name),
            ...account,
          },
          ConditionExpression: "attribute_not_exists(PK)",
        }),
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new AccountAlreadyExistsError(account.id);
      }
      throw err;
    }
    return account;
  }

  async get(accountId: string): Promise<Account | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: keys.account(accountId) }),
    );
    return out.Item ? AccountSchema.parse(out.Item) : null;
  }

  async list(): Promise<Account[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": "TYPE#ACCOUNT" },
        ScanIndexForward: true,
      }),
    );
    return (out.Items ?? []).map((item) => AccountSchema.parse(item));
  }

  /**
   * Webhooks identify the account by its ig user id. The account list is a
   * handful of rows, so filtering the TYPE#ACCOUNT partition is fine at this
   * scale.
   */
  async findByIgUserId(igUserId: string): Promise<Account | null> {
    const all = await this.list();
    return all.find((a) => a.igUserId === igUserId) ?? null;
  }

  async update(accountId: string, patch: UpdateAccountPatch): Promise<Account> {
    const setParts: string[] = ["#updatedAt = :updatedAt"];
    const names: Record<string, string> = { "#updatedAt": "updatedAt" };
    const values: Record<string, unknown> = { ":updatedAt": new Date().toISOString() };

    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      setParts.push(`#${field} = :${field}`);
      names[`#${field}`] = field;
      values[`:${field}`] = value;
    }

    if (patch.name !== undefined) {
      setParts.push("#GSI1SK = :GSI1SK");
      names["#GSI1SK"] = "GSI1SK";
      values[":GSI1SK"] = patch.name;
    }

    try {
      const out = await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: keys.account(accountId),
          UpdateExpression: `SET ${setParts.join(", ")}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ConditionExpression: "attribute_exists(PK)",
          ReturnValues: "ALL_NEW",
        }),
      );
      return AccountSchema.parse(out.Attributes);
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new AccountNotFoundError(accountId);
      }
      throw err;
    }
  }
}

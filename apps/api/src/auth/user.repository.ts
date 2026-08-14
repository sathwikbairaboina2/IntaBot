import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { Inject, Injectable } from "@nestjs/common";
import { User, UserSchema } from "@intabot/shared";
import { AppConfigService } from "../config/config.service";
import { DYNAMO_DOC } from "../dynamo/dynamo.module";
import { keys } from "../dynamo/keys";

@Injectable()
export class UserRepository {
  private readonly table: string;

  constructor(
    @Inject(DYNAMO_DOC) private readonly doc: DynamoDBDocumentClient,
    @Inject(AppConfigService) tableOrConfig: AppConfigService | string,
  ) {
    this.table = typeof tableOrConfig === "string" ? tableOrConfig : tableOrConfig.dynamo.tableMain;
  }

  async create(email: string, passwordHash: string): Promise<User> {
    const user = UserSchema.parse({ email, passwordHash, createdAt: new Date().toISOString() });
    await this.doc.send(
      new PutCommand({ TableName: this.table, Item: { ...keys.user(user.email), ...user } }),
    );
    return user;
  }

  async get(email: string): Promise<User | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: keys.user(email) }),
    );
    return out.Item ? UserSchema.parse(out.Item) : null;
  }
}

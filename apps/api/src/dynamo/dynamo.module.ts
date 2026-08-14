import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Global, Module } from "@nestjs/common";
import { AppConfigService } from "../config/config.service";

export const DYNAMO_DOC = Symbol("DYNAMO_DOC");
export const DYNAMO_RAW = Symbol("DYNAMO_RAW");

@Global()
@Module({
  providers: [
    {
      provide: DYNAMO_RAW,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new DynamoDBClient({
          region: config.dynamo.region,
          ...(config.dynamo.endpoint ? { endpoint: config.dynamo.endpoint } : {}),
        }),
    },
    {
      provide: DYNAMO_DOC,
      inject: [DYNAMO_RAW],
      useFactory: (raw: DynamoDBClient) =>
        DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } }),
    },
  ],
  exports: [DYNAMO_DOC, DYNAMO_RAW],
})
export class DynamoModule {}

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ensureTables } from "../src/dynamo/bootstrap";

export const tableMain = process.env.DYNAMO_TABLE_MAIN!;
export const tableCheckpoints = process.env.DYNAMO_TABLE_CHECKPOINTS!;

export const rawClient = new DynamoDBClient({
  region: process.env.AWS_REGION!,
  endpoint: process.env.DYNAMO_ENDPOINT,
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});

export const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

/** Drops and recreates both tables. Call in beforeEach for isolated tests. */
export async function resetTables(): Promise<void> {
  await ensureTables(
    rawClient,
    { main: tableMain, checkpoints: tableCheckpoints },
    { recreate: true },
  );
}

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
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

// Tables are created once per worker, not once per test. Dropping and
// recreating them in beforeEach made the suite slow and intermittently
// flaky: DynamoDB Local's DeleteTable/CreateTable polling can stall for
// ~20s, and concurrent recreation races. Emptying the items is both
// deterministic and fast.
let tablesReady: Promise<void> | null = null;

async function ensureOnce(): Promise<void> {
  tablesReady ??= ensureTables(rawClient, { main: tableMain, checkpoints: tableCheckpoints });
  return tablesReady;
}

async function clearTable(table: string): Promise<void> {
  for (;;) {
    const scan = await docClient.send(
      new ScanCommand({ TableName: table, ProjectionExpression: "PK, SK" }),
    );
    const items = scan.Items ?? [];
    if (items.length === 0) return;

    for (let i = 0; i < items.length; i += 25) {
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [table]: items.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })),
          },
        }),
      );
    }

    if (!scan.LastEvaluatedKey) return;
  }
}

/** Ensures both tables exist and are empty. Call in beforeEach. */
export async function resetTables(): Promise<void> {
  await ensureOnce();
  await Promise.all([clearTable(tableMain), clearTable(tableCheckpoints)]);
}

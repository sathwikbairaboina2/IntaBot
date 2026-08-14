import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  ResourceNotFoundException,
  waitUntilTableExists,
  waitUntilTableNotExists,
} from "@aws-sdk/client-dynamodb";

export interface TableNames {
  main: string;
  checkpoints: string;
}

async function dropIfExists(client: DynamoDBClient, name: string): Promise<void> {
  try {
    await client.send(new DeleteTableCommand({ TableName: name }));
    await waitUntilTableNotExists({ client, maxWaitTime: 30 }, { TableName: name });
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }
}

async function createIfMissing(client: DynamoDBClient, input: CreateTableCommand): Promise<void> {
  try {
    await client.send(input);
  } catch (err) {
    if (err instanceof ResourceInUseException) return;
    throw err;
  }
}

export async function ensureTables(
  client: DynamoDBClient,
  names: TableNames,
  opts: { recreate?: boolean } = {},
): Promise<void> {
  if (opts.recreate) {
    await dropIfExists(client, names.main);
    await dropIfExists(client, names.checkpoints);
  }

  await createIfMissing(
    client,
    new CreateTableCommand({
      TableName: names.main,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
        { AttributeName: "GSI1PK", AttributeType: "S" },
        { AttributeName: "GSI1SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "GSI1",
          KeySchema: [
            { AttributeName: "GSI1PK", KeyType: "HASH" },
            { AttributeName: "GSI1SK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    }),
  );

  await createIfMissing(
    client,
    new CreateTableCommand({
      TableName: names.checkpoints,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
    }),
  );

  await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: names.main });
  await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: names.checkpoints });
}

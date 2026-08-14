import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureTables } from "./bootstrap";

const client = new DynamoDBClient({
  region: "us-east-1",
  endpoint: process.env.DYNAMO_ENDPOINT,
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});

const names = { main: "bootstrap_main_test", checkpoints: "bootstrap_ckpt_test" };

describe("ensureTables", () => {
  beforeAll(async () => {
    await ensureTables(client, names, { recreate: true });
  });

  it("creates the main table with GSI1", async () => {
    const out = await client.send(new DescribeTableCommand({ TableName: names.main }));
    expect(out.Table?.TableStatus).toBe("ACTIVE");
    expect(out.Table?.GlobalSecondaryIndexes?.map((i) => i.IndexName)).toContain("GSI1");
  });

  it("creates the checkpoints table", async () => {
    const out = await client.send(new DescribeTableCommand({ TableName: names.checkpoints }));
    expect(out.Table?.TableStatus).toBe("ACTIVE");
  });

  it("is idempotent when run twice", async () => {
    await expect(ensureTables(client, names)).resolves.toBeUndefined();
  });
});

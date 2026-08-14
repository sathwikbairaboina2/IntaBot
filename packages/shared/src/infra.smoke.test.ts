import { describe, expect, it } from "vitest";

/**
 * DynamoDB Local rejects unsigned requests with 400 MissingAuthenticationToken.
 * It does not verify the signature, only that an Authorization header is
 * present, so a dummy SigV4 header is enough to reach the service.
 */
const DUMMY_SIGV4 =
  "AWS4-HMAC-SHA256 Credential=local/20260101/us-east-1/dynamodb/aws4_request, " +
  "SignedHeaders=content-type;x-amz-target, Signature=0";

describe("local infrastructure", () => {
  it("has DynamoDB Local reachable on the IntaBot port", async () => {
    const res = await fetch("http://localhost:8200", {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.0",
        "x-amz-target": "DynamoDB_20120810.ListTables",
        authorization: DUMMY_SIGV4,
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { TableNames: string[] };
    expect(Array.isArray(body.TableNames)).toBe(true);
  });
});

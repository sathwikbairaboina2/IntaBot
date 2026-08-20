import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "./signature";
import { parseWebhookEvents } from "./webhook-payload";

const SECRET = "test-app-secret";

function sign(body: Buffer): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

describe("verifySignature", () => {
  const body = Buffer.from(JSON.stringify({ object: "instagram", entry: [] }));

  it("accepts a valid signature", () => {
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const tampered = Buffer.from(body.toString().replace("instagram", "lnstagram"));
    expect(verifySignature(tampered, sign(body), SECRET)).toBe(false);
  });

  it("rejects a missing header, missing body, and wrong prefix", () => {
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
    expect(verifySignature(undefined, sign(body), SECRET)).toBe(false);
    expect(verifySignature(body, sign(body).replace("sha256=", "sha1="), SECRET)).toBe(false);
  });

  it("rejects a wrong-length signature without throwing", () => {
    expect(verifySignature(body, "sha256=abc", SECRET)).toBe(false);
  });
});

describe("parseWebhookEvents", () => {
  it("extracts comment events", () => {
    const events = parseWebhookEvents({
      object: "instagram",
      entry: [
        {
          id: "1784140",
          changes: [
            {
              field: "comments",
              value: {
                id: "c-9",
                media: { id: "m-7" },
                from: { id: "990", username: "fan" },
                text: "Nice!",
              },
            },
          ],
        },
      ],
    });
    expect(events).toEqual([
      {
        eventId: "1784140:c-9",
        accountIgUserId: "1784140",
        igCommentId: "c-9",
        igMediaId: "m-7",
        fromIgUserId: "990",
        fromUsername: "fan",
        text: "Nice!",
      },
    ]);
  });

  it("ignores non-comment changes and malformed bodies", () => {
    expect(
      parseWebhookEvents({
        object: "instagram",
        entry: [{ id: "1", changes: [{ field: "story_insights", value: {} }] }],
      }),
    ).toEqual([]);
    expect(parseWebhookEvents("not an object")).toEqual([]);
    expect(parseWebhookEvents({ object: "instagram", entry: [{ id: "1" }] })).toEqual([]);
  });
});

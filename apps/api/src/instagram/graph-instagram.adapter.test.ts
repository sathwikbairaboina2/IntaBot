import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Account } from "@intabot/shared";
import { TokenCryptoService } from "../crypto/token-crypto.service";
import { GraphInstagramAdapter } from "./graph-instagram.adapter";
import {
  GraphApiError,
  NotImplementedError,
  parseContainerCreated,
  parseContainerStatus,
  parsePermalink,
  parsePublish,
  parsePrivateReply,
  parseReply,
} from "./graph-responses";

const crypto = new TokenCryptoService(Buffer.alloc(32, 3));
const PLAINTEXT_TOKEN = "IGQVJtoken123";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(__dirname, "../../test/fixtures/graph", `${name}.json`), "utf8"),
  );
}

function account(): Account {
  return {
    id: "acct-1",
    name: "Studio Nord",
    igUserId: "1784140",
    username: "studionord",
    status: "ACTIVE",
    accessTokenEncrypted: crypto.encrypt(PLAINTEXT_TOKEN),
    tokenExpiresAt: "2026-10-13T00:00:00.000Z",
    dryRun: false,
    moderationPaused: false,
    timezone: "UTC",
    postingWindows: ["09:00"],
    replyCapPerPostPerHour: 4,
    replyCapPerAccountPerHour: 20,
    blocklist: [],
    linkKeyword: "LINK",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };
}

describe("graph response parsers", () => {
  it("parses each recorded fixture", () => {
    expect(parseContainerCreated(fixture("container-created"))).toEqual({
      containerId: "17900001234567890",
    });
    expect(parseContainerStatus(fixture("container-status-in-progress"))).toBe("IN_PROGRESS");
    expect(parseContainerStatus(fixture("container-status-finished"))).toBe("FINISHED");
    expect(parseContainerStatus(fixture("container-status-error"))).toBe("ERROR");
    expect(parsePublish(fixture("publish-success"))).toEqual({ igMediaId: "17950009876543210" });
    expect(parsePermalink(fixture("permalink")).permalink).toContain("instagram.com");
    expect(parseReply(fixture("reply-success"))).toEqual({ replyId: "17960001112223334" });
    expect(parsePrivateReply(fixture("dm-success"))).toEqual({
      messageId: "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDA",
    });
  });

  it("maps Meta's error envelope to GraphApiError", () => {
    try {
      parseContainerCreated(fixture("error-oauth"));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(GraphApiError);
      expect((err as GraphApiError).code).toBe(190);
    }
  });
});

describe("GraphInstagramAdapter", () => {
  function capture(responses: unknown[]) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchStub = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { json: async () => responses[calls.length - 1] };
    }) as unknown as typeof fetch;
    return { calls, fetchStub };
  }

  it("creates an image container with the decrypted token", async () => {
    const { calls, fetchStub } = capture([fixture("container-created")]);
    const adapter = new GraphInstagramAdapter(
      undefined as never,
      crypto,
      fetchStub,
      "https://graph.test",
    );

    const result = await adapter.createContainer(account(), {
      format: "IMAGE",
      mediaUrl: "https://media.test/a.jpg",
      caption: "Hello",
    });
    expect(result.containerId).toBe("17900001234567890");
    expect(calls[0]!.url).toBe("https://graph.test/1784140/media");
    const body = String(calls[0]!.init?.body);
    expect(body).toContain(`access_token=${PLAINTEXT_TOKEN}`);
    expect(body).toContain("image_url=");
    expect(body).not.toContain("v1%3A"); // never the ciphertext
  });

  it("publishes and resolves the permalink", async () => {
    const { calls, fetchStub } = capture([fixture("publish-success"), fixture("permalink")]);
    const adapter = new GraphInstagramAdapter(
      undefined as never,
      crypto,
      fetchStub,
      "https://graph.test",
    );

    const result = await adapter.publishContainer(account(), "17900001234567890");
    expect(result.igMediaId).toBe("17950009876543210");
    expect(result.permalink).toContain("instagram.com");
    expect(calls[0]!.url).toBe("https://graph.test/1784140/media_publish");
    expect(calls[1]!.url).toContain("/17950009876543210?fields=permalink");
  });

  it("replies to a comment", async () => {
    const { calls, fetchStub } = capture([fixture("reply-success")]);
    const adapter = new GraphInstagramAdapter(
      undefined as never,
      crypto,
      fetchStub,
      "https://graph.test",
    );

    const result = await adapter.replyToComment(account(), "c-9", "Thanks!");
    expect(result.replyId).toBe("17960001112223334");
    expect(calls[0]!.url).toBe("https://graph.test/c-9/replies");
    expect(String(calls[0]!.init?.body)).toContain("message=Thanks%21");
  });

  it("sends a private reply to a comment as JSON with the decrypted token", async () => {
    const { calls, fetchStub } = capture([fixture("dm-success")]);
    const adapter = new GraphInstagramAdapter(
      undefined as never,
      crypto,
      fetchStub,
      "https://graph.test",
    );

    const result = await adapter.sendPrivateReply(account(), "c-9", "Here is the apply link: u");
    expect(result.messageId).toBe("aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDA");
    expect(calls[0]!.url).toBe("https://graph.test/1784140/messages");
    const init = calls[0]!.init!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      recipient: { comment_id: "c-9" },
      message: { text: "Here is the apply link: u" },
    });
    expect(JSON.stringify(init.headers)).toContain(PLAINTEXT_TOKEN);
    expect(String(init.body)).not.toContain(PLAINTEXT_TOKEN);
  });

  it("maps a Meta error on a private reply to GraphApiError", async () => {
    const { fetchStub } = capture([fixture("error-oauth")]);
    const adapter = new GraphInstagramAdapter(undefined as never, crypto, fetchStub, "https://graph.test");
    await expect(adapter.sendPrivateReply(account(), "c-9", "x")).rejects.toBeInstanceOf(
      GraphApiError,
    );
  });

  it("refuses carousels and insights for now", async () => {
    const adapter = new GraphInstagramAdapter(undefined as never, crypto, undefined, "x");
    await expect(
      adapter.createContainer(account(), { format: "CAROUSEL", mediaUrl: "u", caption: "c" }),
    ).rejects.toBeInstanceOf(NotImplementedError);
    await expect(adapter.getMediaInsights(account(), "m")).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });
});

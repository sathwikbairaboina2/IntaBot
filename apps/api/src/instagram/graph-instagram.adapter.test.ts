import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Account } from "@intabot/shared";
import { TokenCryptoService } from "../crypto/token-crypto.service";
import { GraphInstagramAdapter, graphBaseUrl } from "./graph-instagram.adapter";
import {
  GraphApiError,
  GraphError,
  NotImplementedError,
  describeGraphError,
  parseContainerCreated,
  parseContainerStatus,
  parsePermalink,
  parsePublish,
  parsePrivateReply,
  parseReply,
  parseSuccess,
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
    listKeyword: "LIST",
    listText: null,
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
    expect(() => parseSuccess(fixture("success"))).not.toThrow();
    expect(() => parseSuccess({ success: false })).toThrow();
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
  function capture(responses: unknown[], status = 200) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchStub = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
          const body = responses[calls.length - 1];
          if (body === "not-json") throw new SyntaxError("Unexpected token <");
          return body;
        },
      };
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

  function adapterWith(responses: unknown[]) {
    const { calls, fetchStub } = capture(responses);
    const adapter = new GraphInstagramAdapter(
      undefined as never,
      crypto,
      fetchStub,
      "https://graph.test",
    );
    return { calls, adapter };
  }

  it("creates a carousel child container with is_carousel_item and no caption", async () => {
    const { calls, adapter } = adapterWith([fixture("container-created")]);

    await adapter.createContainer(account(), {
      format: "IMAGE",
      mediaUrl: "https://media.test/slide-1.png",
      caption: "ignored",
      isCarouselItem: true,
    });
    expect(calls[0]!.url).toBe("https://graph.test/1784140/media");
    const body = new URLSearchParams(String(calls[0]!.init?.body));
    expect(body.get("image_url")).toBe("https://media.test/slide-1.png");
    expect(body.get("is_carousel_item")).toBe("true");
    expect(body.has("caption")).toBe(false);
    expect(body.has("media_type")).toBe(false);
  });

  it("creates the carousel container from its children and caption", async () => {
    const { calls, adapter } = adapterWith([fixture("container-created")]);

    const result = await adapter.createContainer(account(), {
      format: "CAROUSEL",
      mediaUrl: "",
      caption: "Five roles this week",
      childContainerIds: ["c1", "c2", "c3"],
    });
    expect(result.containerId).toBe("17900001234567890");
    expect(calls[0]!.url).toBe("https://graph.test/1784140/media");
    const body = new URLSearchParams(String(calls[0]!.init?.body));
    expect(body.get("media_type")).toBe("CAROUSEL");
    expect(body.get("children")).toBe("c1,c2,c3");
    expect(body.get("caption")).toBe("Five roles this week");
    expect(body.get("access_token")).toBe(PLAINTEXT_TOKEN);
    expect(body.has("image_url")).toBe(false);
  });

  it("refuses a carousel without children", async () => {
    const { adapter } = adapterWith([]);
    await expect(
      adapter.createContainer(account(), { format: "CAROUSEL", mediaUrl: "", caption: "c" }),
    ).rejects.toThrow(/children/);
  });

  it("creates a reel container that also shares to the feed", async () => {
    const { calls, adapter } = adapterWith([fixture("container-created")]);

    await adapter.createContainer(account(), {
      format: "REEL",
      mediaUrl: "https://media.test/r.mp4",
      caption: "Reel",
    });
    const body = new URLSearchParams(String(calls[0]!.init?.body));
    expect(body.get("media_type")).toBe("REELS");
    expect(body.get("video_url")).toBe("https://media.test/r.mp4");
    expect(body.get("share_to_feed")).toBe("true");
  });

  it("does not add share_to_feed to a story", async () => {
    const { calls, adapter } = adapterWith([fixture("container-created")]);
    await adapter.createContainer(account(), { format: "STORY", mediaUrl: "u", caption: "" });
    const body = new URLSearchParams(String(calls[0]!.init?.body));
    expect(body.get("media_type")).toBe("STORIES");
    expect(body.has("share_to_feed")).toBe(false);
  });

  it("hides and unhides a comment with hide=true|false", async () => {
    const { calls, adapter } = adapterWith([fixture("success"), fixture("success")]);

    await adapter.hideComment(account(), "c-9", true);
    await adapter.hideComment(account(), "c-9", false);
    expect(calls[0]!.url).toBe("https://graph.test/c-9");
    expect(calls[0]!.init?.method).toBe("POST");
    const first = new URLSearchParams(String(calls[0]!.init?.body));
    expect(first.get("hide")).toBe("true");
    expect(first.get("access_token")).toBe(PLAINTEXT_TOKEN);
    expect(new URLSearchParams(String(calls[1]!.init?.body)).get("hide")).toBe("false");
  });

  it("deletes a comment with DELETE /{comment-id}", async () => {
    const { calls, adapter } = adapterWith([fixture("success")]);

    await adapter.deleteComment(account(), "c-9");
    expect(calls[0]!.init?.method).toBe("DELETE");
    expect(calls[0]!.url).toBe(`https://graph.test/c-9?access_token=${PLAINTEXT_TOKEN}`);
  });

  it("maps a Meta error on hide and delete to GraphApiError", async () => {
    const { adapter } = adapterWith([fixture("error-oauth"), fixture("error-oauth")]);
    await expect(adapter.hideComment(account(), "c", true)).rejects.toBeInstanceOf(GraphApiError);
    await expect(adapter.deleteComment(account(), "c")).rejects.toBeInstanceOf(GraphApiError);
  });

  it("refuses insights for now", async () => {
    const adapter = new GraphInstagramAdapter(undefined as never, crypto, undefined, "x");
    await expect(adapter.getMediaInsights(account(), "m")).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });

  describe("graph errors", () => {
    const meta = (code: number, extra: Record<string, unknown> = {}) => ({
      error: { message: `meta says ${code}`, type: "OAuthException", code, fbtrace_id: "TRACE1", ...extra },
    });

    async function failure(status: number, body: unknown) {
      const { fetchStub } = capture([body], status);
      const adapter = new GraphInstagramAdapter(undefined as never, crypto, fetchStub, "https://graph.test");
      try {
        await adapter.replyToComment(account(), "c-1", "hi");
      } catch (err) {
        return err as GraphError;
      }
      throw new Error("expected a GraphError");
    }

    it("types a 400 with code, subcode, type and trace id", async () => {
      const err = await failure(400, meta(100, { error_subcode: 33 }));
      expect(err).toBeInstanceOf(GraphError);
      expect(err).toMatchObject({
        status: 400,
        code: 100,
        subcode: 33,
        type: "OAuthException",
        fbtraceId: "TRACE1",
        message: "meta says 100",
      });
    });

    it("types an expired token (190)", async () => {
      const err = await failure(401, meta(190));
      expect(err).toMatchObject({ status: 401, code: 190 });
    });

    it("types a rate limit (429)", async () => {
      const err = await failure(429, meta(4));
      expect(err).toMatchObject({ status: 429, code: 4 });
    });

    it("types a 500 whose body is not JSON", async () => {
      const err = await failure(500, "not-json");
      expect(err).toBeInstanceOf(GraphError);
      expect(err.status).toBe(500);
      expect(err.message).toMatch(/500/);
    });

    it("rejects a non-2xx response that has no error envelope", async () => {
      const err = await failure(502, { something: "else" });
      expect(err).toBeInstanceOf(GraphError);
      expect(err.status).toBe(502);
    });

    it("still rejects an error envelope that arrives with status 200", async () => {
      const err = await failure(200, meta(10));
      expect(err).toMatchObject({ status: 200, code: 10 });
    });

    it("keeps code and message in the one-line description", () => {
      const err = new GraphError(190, "token expired", { status: 401 });
      expect(describeGraphError(err)).toBe("graph 190: token expired");
      expect(describeGraphError(new Error("boom"))).toBe("boom");
    });
  });

  describe("graph version", () => {
    it("is part of the base url when the module passes one", async () => {
      const { calls, fetchStub } = capture([fixture("reply-success")]);
      const adapter = new GraphInstagramAdapter(
        undefined as never,
        crypto,
        fetchStub,
        graphBaseUrl("v21.0"),
      );
      await adapter.replyToComment(account(), "c-9", "x");
      expect(calls[0]!.url).toBe("https://graph.instagram.com/v21.0/c-9/replies");
      expect(graphBaseUrl(undefined)).toBe("https://graph.instagram.com");
    });
  });

  describe("token refresh", () => {
    it("calls refresh_access_token with the decrypted token and returns the new expiry", async () => {
      const { calls, fetchStub } = capture([
        { access_token: "NEWTOKEN", token_type: "bearer", expires_in: 5184000 },
      ]);
      const adapter = new GraphInstagramAdapter(
        undefined as never,
        crypto,
        fetchStub,
        "https://graph.instagram.com/v21.0",
      );
      const out = await adapter.refreshAccessToken(account());
      expect(out).toEqual({ accessToken: "NEWTOKEN", expiresInSeconds: 5184000 });
      expect(calls[0]!.url).toBe(
        `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${PLAINTEXT_TOKEN}`,
      );
    });

    it("types a refused refresh", async () => {
      const { fetchStub } = capture(
        [{ error: { message: "token too young", type: "IGApiException", code: 100 } }],
        400,
      );
      const adapter = new GraphInstagramAdapter(undefined as never, crypto, fetchStub, "https://graph.test");
      await expect(adapter.refreshAccessToken(account())).rejects.toBeInstanceOf(GraphError);
    });
  });
});

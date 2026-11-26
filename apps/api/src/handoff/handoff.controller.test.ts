import { BadRequestException, ConflictException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryAccounts, MemoryPosts, makeAccount } from "../../test/memory-stubs";
import { HandoffController } from "./handoff.controller";
import type { HandoffClaim } from "./handoff.repository";

function file(mimetype: string, fieldname = "files[]", size = 1000): Express.Multer.File {
  return { fieldname, mimetype, size, buffer: Buffer.alloc(size, 1) } as Express.Multer.File;
}

const png = (n = 1000) => file("image/png", "files[]", n);

class Res {
  code = 201;
  status(code: number) {
    this.code = code;
    return this;
  }
}

describe("HandoffController carousel and reel", () => {
  let posts: MemoryPosts;
  let stored: Array<{ key: string; type: string }>;
  let claims: Map<string, HandoffClaim>;
  let controller: HandoffController;

  function build(accounts = [makeAccount()]) {
    posts = new MemoryPosts();
    stored = [];
    claims = new Map();
    let assetCounter = 0;
    const withSlots = Object.assign(posts, { listScheduledAfter: async () => [] as string[] });
    controller = new HandoffController(
      { handoff: {} } as never,
      new MemoryAccounts(accounts) as never,
      withSlots as never,
      {
        create: async (input: { storageKey: string }) => ({ id: `asset-${++assetCounter}`, ...input }),
      } as never,
      { put: async (key: string, _body: Buffer, type: string) => void stored.push({ key, type }) } as never,
      {
        find: async (id: string) => claims.get(id) ?? null,
        claim: async (id: string, claim: HandoffClaim) => {
          claims.set(id, claim);
          return { won: true as const };
        },
      } as never,
    );
  }

  beforeEach(() => build());

  const card = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ contentId: "content-1", title: "Five roles this week", ...extra });

  describe("carousel", () => {
    it("creates a CAROUSEL post with the slides in order and the template caption", async () => {
      const res = new Res();
      const out = await controller.carousel([png(10), png(20), png(30)], card({ keyword: "ZOHO" }), res as never);
      expect(res.code).toBe(201);
      expect(out).toMatchObject({
        accountId: "acct-1",
        status: "PENDING_APPROVAL",
        created: true,
        caption: "Five roles this week\n\nComment ZOHO and we'll DM you the link.",
      });
      const post = [...posts.items.values()][0]!;
      expect(post).toMatchObject({
        format: "CAROUSEL",
        keyword: "ZOHO",
        mediaAssetIds: ["asset-1", "asset-2", "asset-3"],
        hashtags: ["#hiring", "#jobs"],
        source: { app: "control-room", ref: "content-1" },
      });
      expect(post.applyUrl).toBeUndefined();
      expect(stored.map((s) => s.key.split("-").pop())).toEqual(["1.png", "2.png", "3.png"]);
    });

    it("uses a given caption verbatim and the account keyword when the card names none", async () => {
      await controller.carousel([png(), png()], card({ caption: "My own caption" }), new Res() as never);
      expect([...posts.items.values()][0]!.caption).toBe("My own caption");

      build();
      await controller.carousel([png(), png()], card(), new Res() as never);
      expect([...posts.items.values()][0]!.caption).toContain("Comment LINK and");
    });

    it("stores applyUrl and accepts JPEG mixed with PNG", async () => {
      await controller.carousel(
        [png(), file("image/jpeg")],
        card({ applyUrl: "https://aiiolar.com/jobs?job=x" }),
        new Res() as never,
      );
      expect([...posts.items.values()][0]!.applyUrl).toBe("https://aiiolar.com/jobs?job=x");
      expect(stored.map((s) => s.type)).toEqual(["image/png", "image/jpeg"]);
    });

    it("answers 200 with the same post for a repeated contentId", async () => {
      const first = await controller.carousel([png(), png()], card(), new Res() as never);
      const res = new Res();
      const second = await controller.carousel([png(), png()], card(), res as never);
      expect(res.code).toBe(200);
      expect(second).toMatchObject({ postId: (first as { postId: string }).postId, created: false });
      expect(posts.items.size).toBe(1);
    });

    it("rejects one file, eleven files, a bad type and files under other field names", async () => {
      const bad = (files: Express.Multer.File[]) =>
        expect(controller.carousel(files, card(), new Res() as never)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      await bad([png()]);
      await bad(Array.from({ length: 11 }, () => png()));
      await bad([png(), file("image/webp")]);
      await bad([png(), file("video/mp4")]);
      await bad([png(), file("image/png", "other")]);
      await bad([]);
      expect(posts.items.size).toBe(0);
      expect(stored).toHaveLength(0);
    });

    it("accepts exactly ten files and the plain `files` field name", async () => {
      const out = await controller.carousel(
        Array.from({ length: 10 }, () => file("image/png", "files")),
        card(),
        new Res() as never,
      );
      expect(out).toMatchObject({ created: true });
      expect([...posts.items.values()][0]!.mediaAssetIds).toHaveLength(10);
    });

    it("rejects a bad card with 400 and an unknown account with 409", async () => {
      for (const json of [undefined, "{nope", JSON.stringify({ title: "x" }), card({ keyword: "no way" }), card({ keyword: "a" }), card({ applyUrl: "x" })]) {
        await expect(controller.carousel([png(), png()], json, new Res() as never)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
      await expect(
        controller.carousel([png(), png()], card({ accountId: "nope" }), new Res() as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("reel", () => {
    const mp4 = (size = 5000) => file("video/mp4", "file", size);

    it("creates a REEL post from one mp4", async () => {
      const out = await controller.reel(mp4(), card({ keyword: "ZOHO" }), new Res() as never);
      expect(out).toMatchObject({ created: true, status: "PENDING_APPROVAL" });
      const post = [...posts.items.values()][0]!;
      expect(post).toMatchObject({ format: "REEL", keyword: "ZOHO", mediaAssetIds: ["asset-1"] });
      expect(stored[0]).toMatchObject({ type: "video/mp4" });
      expect(stored[0]!.key.endsWith(".mp4")).toBe(true);
    });

    it("accepts mov", async () => {
      await controller.reel(file("video/quicktime", "file"), card(), new Res() as never);
      expect(stored[0]!.key.endsWith(".mov")).toBe(true);
    });

    it("is idempotent per contentId", async () => {
      await controller.reel(mp4(), card(), new Res() as never);
      const res = new Res();
      await controller.reel(mp4(), card(), res as never);
      expect(res.code).toBe(200);
      expect(posts.items.size).toBe(1);
    });

    it("rejects a missing file, an image, an oversized or empty file", async () => {
      for (const f of [undefined, file("image/png", "file"), mp4(100 * 1024 * 1024 + 1), mp4(0)]) {
        await expect(controller.reel(f, card(), new Res() as never)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
      expect(posts.items.size).toBe(0);
    });

    it("keeps a reel and a carousel with the same contentId apart only by claim: first one wins", async () => {
      await controller.reel(mp4(), card(), new Res() as never);
      const res = new Res();
      await controller.carousel([png(), png()], card(), res as never);
      expect(res.code).toBe(200);
      expect(posts.items.size).toBe(1);
    });
  });

  describe("job-card keyword", () => {
    const jobCard = (extra: Record<string, unknown> = {}) =>
      JSON.stringify({
        cardId: "card-1",
        role: "Backend Engineer",
        company: "Acme",
        experience: "2-4 yrs",
        location: "Bengaluru",
        eligibility: "B.Tech",
        applyUrl: "https://aiiolar.com/jobs?job=acme",
        ...extra,
      });
    const cardFile = file("image/png", "file");

    it("puts a given keyword in the caption and on the post", async () => {
      const out = (await controller.jobCard(cardFile, jobCard({ keyword: "ZOHO" }), new Res() as never)) as {
        caption: string;
      };
      expect(out.caption.endsWith("Comment ZOHO and we'll DM you the link.")).toBe(true);
      expect([...posts.items.values()][0]!.keyword).toBe("ZOHO");
    });

    it("falls back to the account linkKeyword and stores no post keyword", async () => {
      const out = (await controller.jobCard(cardFile, jobCard(), new Res() as never)) as { caption: string };
      expect(out.caption.endsWith("Comment LINK and we'll DM you the link.")).toBe(true);
      expect([...posts.items.values()][0]!.keyword).toBeUndefined();
    });

    it.each(["a", "has space", "x".repeat(21), "bang!"])("rejects keyword %j with 400", async (keyword) => {
      await expect(
        controller.jobCard(cardFile, jobCard({ keyword }), new Res() as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

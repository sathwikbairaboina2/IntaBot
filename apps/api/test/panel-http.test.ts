// HTTP checks that need no database: they are all refused before any storage
// call. Boots the real AppModule, so DI wiring and multipart field handling
// are exercised; the Redis and DynamoDB clients stay unconnected.
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";

const KEY = "panel-http-key";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("panel endpoints without a database", () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.HANDOFF_KEY = KEY;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app.close();
    delete process.env.HANDOFF_KEY;
  });

  const guarded: Array<["get" | "post" | "delete", string]> = [
    ["get", "/comments?accountId=x"],
    ["get", "/posts/p-1/comments"],
    ["get", "/posts?accountId=x&status=APPROVED"],
    ["get", "/posts/p-1"],
    ["post", "/posts/p-1/retry"],
    ["post", "/comments/c-1/reply"],
    ["post", "/comments/c-1/hide"],
    ["post", "/comments/c-1/dm"],
    ["delete", "/comments/c-1"],
    ["get", "/status/launch"],
    ["post", "/approvals/p-1/approve"],
    ["post", "/approvals/p-1/reject"],
  ];

  it.each(guarded)("%s %s answers 401 with no key and no session", async (method, path) => {
    await http()[method](path).expect(401);
  });

  it.each(guarded)("%s %s answers 401 for a wrong key", async (method, path) => {
    await http()[method](path).set("x-handoff-key", "nope").expect(401);
  });

  it("answers the launch status to the key, with no secrets in it", async () => {
    const res = await http().get("/status/launch").set("x-handoff-key", KEY).expect(200);
    expect(res.body).toEqual({
      mode: expect.stringMatching(/^(live|fake)$/),
      graphVersion: null,
      defaultTimezone: "Asia/Kolkata",
      mediaUrlPublic: expect.any(Boolean),
      mediaHost: expect.any(String),
      webhookConfigured: expect.any(Boolean),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|password|token/i);
  });

  it("still guards the existing session routes", async () => {
    await http().get("/accounts").set("x-handoff-key", KEY).expect(401);
    await http().get("/moderation?accountId=x").set("x-handoff-key", KEY).expect(401);
  });

  it("answers 400 for a missing accountId or postId before touching storage", async () => {
    await http().get("/comments").set("x-handoff-key", KEY).expect(400);
    await http().get("/posts?status=APPROVED").set("x-handoff-key", KEY).expect(400);
    await http().post("/comments/c-1/reply").set("x-handoff-key", KEY).send({ text: "x" }).expect(400);
    await http().delete("/comments/c-1").set("x-handoff-key", KEY).expect(400);
  });

  describe("handoff uploads", () => {
    const card = JSON.stringify({ contentId: "content-1", title: "Five roles" });

    function carousel(count: number, opts: { key?: string | null; mime?: string; field?: string } = {}) {
      const req = http().post("/handoff/carousel");
      if (opts.key !== null) req.set("x-handoff-key", opts.key ?? KEY);
      req.field("card", card);
      for (let i = 0; i < count; i++) {
        req.attach(opts.field ?? "files[]", PNG, {
          filename: `s${i}.png`,
          contentType: opts.mime ?? "image/png",
        });
      }
      return req;
    }

    it("refuses a carousel without the key", async () => {
      await carousel(3, { key: null }).expect(401);
      await carousel(3, { key: "nope" }).expect(401);
    });

    it("answers 400 for one image, eleven images, a bad type and a wrong field name", async () => {
      await carousel(1).expect(400);
      await carousel(11).expect(400);
      await carousel(2, { mime: "image/webp" }).expect(400);
      await carousel(2, { mime: "video/mp4" }).expect(400);
      await carousel(3, { field: "pictures" }).expect(400);
    });

    it("answers 400 for a carousel card that does not validate", async () => {
      const send = (cardJson: string) =>
        http()
          .post("/handoff/carousel")
          .set("x-handoff-key", KEY)
          .field("card", cardJson)
          .attach("files[]", PNG, { filename: "a.png", contentType: "image/png" })
          .attach("files[]", PNG, { filename: "b.png", contentType: "image/png" });
      await send("{nope").expect(400);
      await send(JSON.stringify({ title: "no content id" })).expect(400);
      await send(JSON.stringify({ contentId: "c", title: "t", keyword: "two words" })).expect(400);
      await send(JSON.stringify({ contentId: "c", title: "t", applyUrl: "not a url" })).expect(400);
    });

    it("answers 400 for a reel with no file, an image or a bad card", async () => {
      const reel = () => http().post("/handoff/reel").set("x-handoff-key", KEY);
      await reel().field("card", card).expect(400);
      await reel()
        .field("card", card)
        .attach("file", PNG, { filename: "a.png", contentType: "image/png" })
        .expect(400);
      await reel()
        .field("card", "{nope")
        .attach("file", Buffer.alloc(10, 1), { filename: "r.mp4", contentType: "video/mp4" })
        .expect(400);
      await http()
        .post("/handoff/reel")
        .field("card", card)
        .attach("file", Buffer.alloc(10, 1), { filename: "r.mp4", contentType: "video/mp4" })
        .expect(401);
    });

    it("rejects a job-card keyword that is not 2-20 letters or digits", async () => {
      const jobCard = {
        cardId: "card-1",
        role: "Backend Engineer",
        company: "Acme",
        experience: "2-4 yrs",
        location: "Bengaluru",
        eligibility: "B.Tech",
        applyUrl: "https://aiiolar.com/jobs?job=acme",
        keyword: "has space",
      };
      await http()
        .post("/handoff/job-card")
        .set("x-handoff-key", KEY)
        .field("card", JSON.stringify(jobCard))
        .attach("file", PNG, { filename: "c.png", contentType: "image/png" })
        .expect(400);
    });
  });
});
